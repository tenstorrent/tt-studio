// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Close-button behavior.
//!
//! What the window's close button does is a setting: ask (the existing quit
//! dialogs), minimize to the tray, quit but leave the stack running, or stop
//! the stack (local child or remote over ssh) on the way out. The decision
//! itself is a pure function over the setting and the session kind so the
//! whole matrix is unit-testable; the CloseRequested handler in lib.rs just
//! executes the returned action.
//!
//! Quitting from the tray menu ignores "minimize to tray" (a tray quit must
//! actually quit) but still honors the ask-vs-stop semantics.

use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{Manager, Wry};
use tauri_plugin_store::StoreExt;

const SETTINGS_STORE: &str = "settings.json";
const BEHAVIOR_KEY: &str = "close_behavior";

/// The user's close-button preference, persisted with the app settings.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    /// Ask via the existing quit dialogs (default).
    #[default]
    Ask,
    /// Hide the window; the tray keeps the app reachable.
    MinimizeToTray,
    /// Quit the app, leave the stack running (local host services and remote
    /// stacks both survive on purpose).
    KeepRunning,
    /// `run.py --stop` on whatever this session runs, then quit.
    StopStack,
}

/// How this session relates to a stack, in precedence order (mirrors the
/// original CloseRequested handler: a local stack wins over an SSH view).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionKind {
    /// This session spawned or attached to the local stack.
    LocalStack,
    /// An SSH connection is active and the window shows the remote stack.
    SshActive,
    /// Neither — closing has nothing to tear down.
    Detached,
}

/// What the close handler should do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseAction {
    /// Let the close proceed (process exit tears everything down).
    CloseNormally,
    /// Hide the window instead of closing.
    Hide,
    /// Show the native stop-or-keep dialog (local stack).
    AskLocal,
    /// Navigate to the launcher's ?quit=1 prompt (remote stack).
    AskRemote,
    /// `run.py --stop` locally, then exit.
    StopLocalThenExit,
    /// `run.py --stop` on the active remote, then exit.
    StopRemoteThenExit,
}

/// The whole close-button decision matrix.
pub fn close_action(behavior: CloseBehavior, session: SessionKind) -> CloseAction {
    match behavior {
        CloseBehavior::MinimizeToTray => CloseAction::Hide,
        CloseBehavior::KeepRunning => CloseAction::CloseNormally,
        CloseBehavior::StopStack => match session {
            SessionKind::LocalStack => CloseAction::StopLocalThenExit,
            SessionKind::SshActive => CloseAction::StopRemoteThenExit,
            SessionKind::Detached => CloseAction::CloseNormally,
        },
        CloseBehavior::Ask => match session {
            SessionKind::LocalStack => CloseAction::AskLocal,
            SessionKind::SshActive => CloseAction::AskRemote,
            SessionKind::Detached => CloseAction::CloseNormally,
        },
    }
}

// ---- persistence ----

pub fn stored_behavior(app: &tauri::AppHandle<Wry>) -> CloseBehavior {
    app.store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(BEHAVIOR_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_close_behavior(app: tauri::AppHandle<Wry>) -> CloseBehavior {
    stored_behavior(&app)
}

#[tauri::command]
pub fn set_close_behavior(
    app: tauri::AppHandle<Wry>,
    behavior: CloseBehavior,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    store.set(
        BEHAVIOR_KEY,
        serde_json::to_value(behavior).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

// ---- executing the decision ----

pub(crate) fn session_kind(app: &tauri::AppHandle<Wry>) -> SessionKind {
    let launcher_state = app.state::<crate::state::LauncherState>();
    if launcher_state.local_stack.load(Ordering::SeqCst) {
        return SessionKind::LocalStack;
    }
    let tunnels = app.state::<crate::ssh::commands::TunnelState>();
    if tunnels.active_profile().is_some() && crate::ssh::commands::showing_remote_stack(app) {
        return SessionKind::SshActive;
    }
    SessionKind::Detached
}

/// Best-effort remote stop, then exit. Close-button semantics: quitting must
/// succeed even when the stop can't (the ask flow is the careful path).
fn stop_remote_then_exit(app: &tauri::AppHandle<Wry>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use crate::ssh::SshTransport;
        use tauri::Emitter;
        let tunnels = app.state::<crate::ssh::commands::TunnelState>();
        if let Some(profile) = tunnels.active_profile() {
            if let Ok(session) = crate::remote::connect_session(&app, &profile).await {
                let command = crate::remote::stop_command(&crate::remote::repo_path(&profile));
                let line_app = app.clone();
                let _ = session
                    .exec_stream(
                        &command,
                        |line| {
                            let _ = line_app.emit(crate::remote::REMOTE_STOP_EVENT, line);
                        },
                        |_| {},
                    )
                    .await;
                session.close().await;
            }
        }
        tunnels.shutdown().await;
        app.exit(0);
    });
}

/// Run a close decision. `api` is present when called from CloseRequested
/// (so the close can be prevented); a tray-menu quit passes None and treats
/// Hide/CloseNormally as a plain exit.
pub(crate) fn run_close_action(
    app: &tauri::AppHandle<Wry>,
    action: CloseAction,
    api: Option<&tauri::CloseRequestApi>,
) {
    let launcher_state = app.state::<crate::state::LauncherState>();
    match action {
        CloseAction::CloseNormally => {
            if api.is_none() {
                app.exit(0);
            }
        }
        CloseAction::Hide => {
            if let Some(api) = api {
                api.prevent_close();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            } else {
                app.exit(0);
            }
        }
        CloseAction::AskLocal => {
            if let Some(api) = api {
                api.prevent_close();
            }
            if launcher_state.quitting.swap(true, Ordering::SeqCst) {
                return; // quit flow already in flight
            }
            crate::launcher::confirm_quit(app);
        }
        CloseAction::AskRemote => {
            if let Some(api) = api {
                api.prevent_close();
            }
            crate::ssh::commands::show_quit_prompt(app);
        }
        CloseAction::StopLocalThenExit => {
            if let Some(api) = api {
                api.prevent_close();
            }
            if launcher_state.quitting.swap(true, Ordering::SeqCst) {
                return;
            }
            crate::launcher::stop_stack_then_exit(app);
        }
        CloseAction::StopRemoteThenExit => {
            if let Some(api) = api {
                api.prevent_close();
            }
            if launcher_state.quitting.swap(true, Ordering::SeqCst) {
                return;
            }
            stop_remote_then_exit(app);
        }
    }
}

/// The CloseRequested entry point: setting × session → action.
pub(crate) fn on_close_requested(window: &tauri::Window<Wry>, api: &tauri::CloseRequestApi) {
    if window.label() != "main" {
        return;
    }
    let app = window.app_handle();
    let action = close_action(stored_behavior(app), session_kind(app));
    run_close_action(app, action, Some(api));
}

/// A quit from the tray menu: never minimizes, otherwise same semantics.
pub(crate) fn request_quit(app: &tauri::AppHandle<Wry>) {
    let behavior = match stored_behavior(app) {
        CloseBehavior::MinimizeToTray => CloseBehavior::Ask,
        other => other,
    };
    run_close_action(app, close_action(behavior, session_kind(app)), None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_matrix_covers_every_combination() {
        use CloseAction::*;
        use CloseBehavior::*;
        use SessionKind::*;
        let cases = [
            // Ask keeps the existing dialog flows.
            (Ask, LocalStack, AskLocal),
            (Ask, SshActive, AskRemote),
            (Ask, Detached, CloseNormally),
            // Minimize hides regardless of what's running.
            (MinimizeToTray, LocalStack, Hide),
            (MinimizeToTray, SshActive, Hide),
            (MinimizeToTray, Detached, Hide),
            // Keep running quits without ceremony.
            (KeepRunning, LocalStack, CloseNormally),
            (KeepRunning, SshActive, CloseNormally),
            (KeepRunning, Detached, CloseNormally),
            // Stop stack tears down whatever this session runs.
            (StopStack, LocalStack, StopLocalThenExit),
            (StopStack, SshActive, StopRemoteThenExit),
            (StopStack, Detached, CloseNormally),
        ];
        for (behavior, session, expected) in cases {
            assert_eq!(
                close_action(behavior, session),
                expected,
                "{behavior:?} × {session:?}"
            );
        }
    }

    #[test]
    fn behavior_serializes_snake_case_and_defaults_to_ask() {
        assert_eq!(CloseBehavior::default(), CloseBehavior::Ask);
        assert_eq!(
            serde_json::to_value(CloseBehavior::MinimizeToTray).unwrap(),
            serde_json::json!("minimize_to_tray")
        );
        let parsed: CloseBehavior =
            serde_json::from_value(serde_json::json!("stop_stack")).unwrap();
        assert_eq!(parsed, CloseBehavior::StopStack);
        // Unknown store values fall back to the default at the read site.
        assert!(serde_json::from_value::<CloseBehavior>(serde_json::json!("bogus")).is_err());
    }
}
