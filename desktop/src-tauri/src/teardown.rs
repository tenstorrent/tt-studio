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

/// What an exit request (as opposed to a window close) should do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitAction {
    /// Let the process go.
    Proceed,
    /// Hold the exit and run a close decision instead.
    Intercept(CloseAction),
}

/// The exit decision. `code` is None for a user-initiated exit and Some for
/// a programmatic one — our own `app.exit()` at the end of every quit flow,
/// and the updater's relaunch. Intercepting those would have the quit flow
/// deadlock against itself, so they always proceed.
pub fn exit_action(
    code: Option<i32>,
    quitting: bool,
    behavior: CloseBehavior,
    session: SessionKind,
) -> ExitAction {
    if code.is_some() || quitting {
        return ExitAction::Proceed;
    }
    match close_action(behavior, session) {
        // Hiding is meaningless once the app is on its way out.
        CloseAction::CloseNormally | CloseAction::Hide => ExitAction::Proceed,
        action => ExitAction::Intercept(action),
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
        // A bring-up still streaming would race the stop it is about to
        // undo (remote::quit_app does the same before its own --stop).
        app.state::<crate::remote::RemoteState>().cancel().await;
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
            // Unlike the other guarded branches this one can end without
            // exiting — the prompt has a Cancel — so the latch is released
            // by `cancel_quit` rather than by the process going away.
            if launcher_state.quitting.swap(true, Ordering::SeqCst) {
                return; // prompt already showing
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

/// Release the quit latch after the user backs out of the quit prompt, so a
/// later close request shows it again instead of being swallowed.
#[tauri::command]
pub fn cancel_quit(state: tauri::State<'_, crate::state::LauncherState>) {
    state.quitting.store(false, Ordering::SeqCst);
}

/// The ExitRequested entry point: the last window being destroyed, or a
/// programmatic exit. Mirrors `on_close_requested` but holds the *process*.
pub(crate) fn on_exit_requested(
    app: &tauri::AppHandle<Wry>,
    code: Option<i32>,
    api: &tauri::ExitRequestApi,
) {
    let quitting = app
        .state::<crate::state::LauncherState>()
        .quitting
        .load(Ordering::SeqCst);
    let action = exit_action(code, quitting, stored_behavior(app), session_kind(app));
    if let ExitAction::Intercept(action) = action {
        api.prevent_exit();
        run_close_action(app, action, None);
    }
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
    fn a_user_initiated_exit_asks_exactly_like_the_close_button() {
        use CloseAction::*;
        use CloseBehavior::*;
        use ExitAction::Intercept;
        use SessionKind::*;
        // The macOS Cmd+Q path: same question the close button would ask.
        for (behavior, session, expected) in [
            (Ask, LocalStack, Intercept(AskLocal)),
            (Ask, SshActive, Intercept(AskRemote)),
            (StopStack, LocalStack, Intercept(StopLocalThenExit)),
            (StopStack, SshActive, Intercept(StopRemoteThenExit)),
        ] {
            assert_eq!(
                exit_action(None, false, behavior, session),
                expected,
                "{behavior:?} × {session:?}"
            );
        }
    }

    #[test]
    fn nothing_to_tear_down_never_holds_the_exit() {
        use CloseBehavior::*;
        use SessionKind::*;
        for behavior in [Ask, MinimizeToTray, KeepRunning, StopStack] {
            assert_eq!(
                exit_action(None, false, behavior, Detached),
                ExitAction::Proceed,
                "{behavior:?} × Detached"
            );
        }
        // Hiding a window the app is already leaving is nonsense.
        for session in [LocalStack, SshActive, Detached] {
            assert_eq!(
                exit_action(None, false, MinimizeToTray, session),
                ExitAction::Proceed,
                "minimize × {session:?}"
            );
        }
        for session in [LocalStack, SshActive] {
            assert_eq!(
                exit_action(None, false, KeepRunning, session),
                ExitAction::Proceed
            );
        }
    }

    #[test]
    fn programmatic_exits_are_never_intercepted() {
        use CloseBehavior::*;
        use SessionKind::*;
        // Every quit flow ends in app.exit(); so does the updater's relaunch.
        // Holding those would deadlock the quit against itself.
        for behavior in [Ask, MinimizeToTray, KeepRunning, StopStack] {
            for session in [LocalStack, SshActive, Detached] {
                assert_eq!(
                    exit_action(Some(0), false, behavior, session),
                    ExitAction::Proceed,
                    "code=Some × {behavior:?} × {session:?}"
                );
                // …and once a quit is in flight, the second pass proceeds.
                assert_eq!(
                    exit_action(None, true, behavior, session),
                    ExitAction::Proceed,
                    "quitting × {behavior:?} × {session:?}"
                );
            }
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
