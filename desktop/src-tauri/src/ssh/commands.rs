// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Tauri surface of the tunnel engine.
//!
//! `start_ssh_tunnels` turns a saved SSH profile into a running supervisor;
//! every status change is pushed to the UI as a `tunnel-status` event. When
//! the tunnel is hard-lost while the window is showing the remote stack,
//! the window is navigated back to the bundled launcher (the stack page is
//! unreachable at that point anyway).

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, Url};

use super::known_hosts::KnownHostsVerifier;
use super::session::{AuthMethod, SshSession, SshTarget};
use super::tunnel::{Supervisor, SupervisorConfig, TunnelPhase, TunnelStatus};
use super::{SshError, SshTransport};
use crate::profiles::{Profile, ProfileKind, SshAuth};
use crate::secrets;

pub const TUNNEL_EVENT: &str = "tunnel-status";
const DEFAULT_SSH_PORT: u16 = 22;

/// At most one tunnel supervisor runs at a time (one remote stack per window).
#[derive(Default)]
pub struct TunnelState(tokio::sync::Mutex<Option<Supervisor>>);

/// Build the dial target from a saved profile: agent auth is always tried
/// first, then the profile's key file with the keychain passphrase if one
/// is stored (see `secrets.rs`).
fn target_from_profile(profile: &Profile, home: Option<PathBuf>) -> Result<SshTarget, SshError> {
    if profile.kind != ProfileKind::Ssh {
        return Err(SshError::Internal {
            message: "profile is not an SSH profile".into(),
        });
    }
    let host = profile.host.clone().filter(|h| !h.trim().is_empty());
    let user = profile.user.clone().filter(|u| !u.trim().is_empty());
    let (Some(host), Some(user)) = (host, user) else {
        return Err(SshError::Internal {
            message: "profile is missing host or user".into(),
        });
    };

    let mut auth = vec![AuthMethod::Agent];
    if let Some(SshAuth::Key { path }) = &profile.auth {
        let passphrase = secrets::load_passphrase(&profile.id).ok();
        auth.push(AuthMethod::KeyFile {
            path: expand_tilde(path, home),
            passphrase,
        });
    }

    Ok(SshTarget {
        host,
        port: profile.port.unwrap_or(DEFAULT_SSH_PORT),
        user,
        auth,
    })
}

/// Profiles store key paths the way users type them (`~/.ssh/id_ed25519`).
fn expand_tilde(path: &str, home: Option<PathBuf>) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// Where "back to the launcher" points: the dev server during development,
/// the bundled app origin in production builds.
fn launcher_url(app: &AppHandle) -> Option<Url> {
    if let Some(dev_url) = &app.config().build.dev_url {
        return Some(dev_url.clone());
    }
    #[cfg(windows)]
    let url = "http://tauri.localhost";
    #[cfg(not(windows))]
    let url = "tauri://localhost";
    Url::parse(url).ok()
}

/// True when the main window currently shows the remote stack (a plain
/// http(s) origin) rather than the bundled launcher.
fn showing_remote_stack(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let Ok(current) = window.url() else {
        return false;
    };
    let launcher = launcher_url(app);
    match launcher {
        Some(l) if l.origin() == current.origin() => false,
        _ => matches!(current.scheme(), "http" | "https"),
    }
}

/// On hard loss while the stack page is showing, bring the user back to the
/// launcher — the stack's origin is dead, so leaving it up is a blank page.
fn return_to_launcher_if_lost(app: &AppHandle, status: &TunnelStatus) {
    if !matches!(status.phase, TunnelPhase::Lost { .. }) || !showing_remote_stack(app) {
        return;
    }
    let Some(url) = launcher_url(app) else { return };
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.navigate(url);
        }
    });
}

#[tauri::command]
pub async fn start_ssh_tunnels(
    app: AppHandle,
    state: tauri::State<'_, TunnelState>,
    profile: Profile,
) -> Result<(), SshError> {
    let home = app.path().home_dir().ok();
    let target = target_from_profile(&profile, home)?;
    let verifier = KnownHostsVerifier::for_app(&app)?;

    let connector: super::tunnel::Connector = Arc::new(move || {
        let target = target.clone();
        let verifier = verifier.clone();
        Box::pin(async move {
            SshSession::connect(&target, verifier)
                .await
                .map(|s| Arc::new(s) as Arc<dyn SshTransport>)
        })
    });

    let sink_app = app.clone();
    let sink: super::tunnel::StatusSink = Arc::new(move |status: TunnelStatus| {
        let _ = sink_app.emit(TUNNEL_EVENT, &status);
        return_to_launcher_if_lost(&sink_app, &status);
    });

    let mut guard = state.0.lock().await;
    if let Some(previous) = guard.take() {
        previous.stop().await;
    }
    *guard = Some(Supervisor::spawn(
        SupervisorConfig::default(),
        connector,
        sink,
    ));
    Ok(())
}

#[tauri::command]
pub async fn stop_ssh_tunnels(state: tauri::State<'_, TunnelState>) -> Result<(), SshError> {
    if let Some(supervisor) = state.0.lock().await.take() {
        supervisor.stop().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_tunnel_status(
    state: tauri::State<'_, TunnelState>,
) -> Result<Option<TunnelStatus>, SshError> {
    Ok(state.0.lock().await.as_ref().map(|s| s.status()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh_profile() -> Profile {
        Profile {
            id: "p1".into(),
            name: "QuietBox".into(),
            kind: ProfileKind::Ssh,
            host: Some("qb2.example.com".into()),
            port: None,
            user: Some("jashan".into()),
            auth: Some(SshAuth::Key {
                path: "~/.ssh/id_ed25519".into(),
            }),
            remote_repo_path: None,
            last_used: None,
        }
    }

    #[test]
    fn target_tries_agent_before_key_file() {
        let target = target_from_profile(&ssh_profile(), Some(PathBuf::from("/home/u"))).unwrap();
        assert_eq!(target.host, "qb2.example.com");
        assert_eq!(target.port, 22);
        assert!(matches!(target.auth[0], AuthMethod::Agent));
        match &target.auth[1] {
            AuthMethod::KeyFile { path, .. } => {
                assert_eq!(path, &PathBuf::from("/home/u/.ssh/id_ed25519"));
            }
            other => panic!("expected key file, got {other:?}"),
        }
    }

    #[test]
    fn agent_only_profile_has_single_method() {
        let mut profile = ssh_profile();
        profile.auth = Some(SshAuth::Agent);
        let target = target_from_profile(&profile, None).unwrap();
        assert_eq!(target.auth.len(), 1);
        assert!(matches!(target.auth[0], AuthMethod::Agent));
    }

    #[test]
    fn local_or_incomplete_profiles_are_rejected() {
        let mut local = ssh_profile();
        local.kind = ProfileKind::Local;
        assert!(target_from_profile(&local, None).is_err());

        let mut no_user = ssh_profile();
        no_user.user = None;
        assert!(target_from_profile(&no_user, None).is_err());

        let mut blank_host = ssh_profile();
        blank_host.host = Some("  ".into());
        assert!(target_from_profile(&blank_host, None).is_err());
    }

    #[test]
    fn tilde_expansion_uses_home_dir() {
        assert_eq!(
            expand_tilde("~/.ssh/key", Some(PathBuf::from("/home/u"))),
            PathBuf::from("/home/u/.ssh/key")
        );
        assert_eq!(
            expand_tilde("/abs/key", Some(PathBuf::from("/home/u"))),
            PathBuf::from("/abs/key")
        );
        assert_eq!(expand_tilde("~/key", None), PathBuf::from("~/key"));
    }
}
