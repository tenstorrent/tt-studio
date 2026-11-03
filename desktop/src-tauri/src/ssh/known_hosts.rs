// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Trust-on-first-use host key verification.
//!
//! Keys live in an app-managed known_hosts file (OpenSSH format, in the app
//! config dir) — deliberately separate from `~/.ssh/known_hosts` so the
//! desktop shell never mutates the user's own SSH state. The three outcomes:
//!
//! - known & matching → connect proceeds;
//! - never seen → the connect fails with `unknown_host_key` carrying the
//!   fingerprint; the UI shows a trust dialog and, on accept, calls the
//!   `trust_host_key` command and reconnects;
//! - seen but DIFFERENT → hard fail (`changed_host_key`), never promptable,
//!   because that is what a machine-in-the-middle looks like.

use std::path::PathBuf;
use std::sync::Arc;

use russh::keys::{known_hosts, HashAlg, PublicKey};
use tauri::Manager;

use super::{HostKeyVerifier, SshError};

pub const KNOWN_HOSTS_FILE: &str = "known_hosts";

/// File-backed [`HostKeyVerifier`] over the app-managed known_hosts file.
pub struct KnownHostsVerifier {
    path: PathBuf,
}

impl KnownHostsVerifier {
    pub fn new(path: PathBuf) -> Arc<Self> {
        Arc::new(Self { path })
    }

    /// The verifier used by real connections: `<app config dir>/known_hosts`.
    pub fn for_app(app: &tauri::AppHandle) -> Result<Arc<Self>, SshError> {
        Ok(Self::new(app_known_hosts_path(app)?))
    }
}

impl HostKeyVerifier for KnownHostsVerifier {
    fn verify(&self, host: &str, port: u16, key: &PublicKey) -> Result<(), SshError> {
        // No file yet means first use of any host: plain unknown, not an error.
        if !self.path.exists() {
            return Err(unknown_host_key(host, port, key));
        }
        match known_hosts::check_known_hosts_path(host, port, key, &self.path) {
            Ok(true) => Ok(()),
            Ok(false) => Err(unknown_host_key(host, port, key)),
            Err(russh::keys::Error::KeyChanged { .. }) => Err(SshError::ChangedHostKey {
                host: host.to_string(),
                port,
                fingerprint: fingerprint(key),
            }),
            Err(e) => Err(SshError::KnownHosts {
                message: e.to_string(),
            }),
        }
    }
}

/// Persist a key the user explicitly accepted in the TOFU dialog.
pub fn trust(
    path: &std::path::Path,
    host: &str,
    port: u16,
    public_key: &str,
) -> Result<(), SshError> {
    let key: PublicKey = public_key.parse().map_err(|e| SshError::KnownHosts {
        message: format!("invalid public key: {e}"),
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| SshError::KnownHosts {
            message: e.to_string(),
        })?;
    }
    known_hosts::learn_known_hosts_path(host, port, &key, path).map_err(|e| SshError::KnownHosts {
        message: e.to_string(),
    })
}

pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

fn unknown_host_key(host: &str, port: u16, key: &PublicKey) -> SshError {
    SshError::UnknownHostKey {
        host: host.to_string(),
        port,
        key_type: key.algorithm().to_string(),
        fingerprint: fingerprint(key),
        public_key: key.to_openssh().unwrap_or_default(),
    }
}

fn app_known_hosts_path(app: &tauri::AppHandle) -> Result<PathBuf, SshError> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(KNOWN_HOSTS_FILE))
        .map_err(|e| SshError::KnownHosts {
            message: format!("no app config dir: {e}"),
        })
}

/// Persist a host key the user accepted in the trust dialog, then let the UI
/// retry the connection.
#[tauri::command]
pub fn trust_host_key(
    app: tauri::AppHandle,
    host: String,
    port: u16,
    public_key: String,
) -> Result<(), SshError> {
    trust(&app_known_hosts_path(&app)?, &host, port, &public_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Public host keys are public by definition — these are the published
    // keys of github.com and gitlab.com, used purely as test fixtures.
    const KEY_A: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
    const KEY_B: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfuCHKVTjquxvt6CM6tdG4SLp1Btn/nOeHHE5UOzRdf";

    fn key(s: &str) -> PublicKey {
        s.parse().unwrap()
    }

    fn temp_known_hosts() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        (dir, path)
    }

    #[test]
    fn first_contact_reports_unknown_with_fingerprint() {
        let (_dir, path) = temp_known_hosts();
        let verifier = KnownHostsVerifier::new(path);
        let err = verifier.verify("qb2", 22, &key(KEY_A)).unwrap_err();
        match err {
            SshError::UnknownHostKey {
                host,
                port,
                key_type,
                fingerprint,
                public_key,
            } => {
                assert_eq!(host, "qb2");
                assert_eq!(port, 22);
                assert_eq!(key_type, "ssh-ed25519");
                assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
                assert!(public_key.starts_with("ssh-ed25519 "));
            }
            other => panic!("expected UnknownHostKey, got {other:?}"),
        }
    }

    #[test]
    fn trusted_key_verifies_and_stays_scoped_to_host_and_port() {
        let (_dir, path) = temp_known_hosts();
        trust(&path, "qb2", 22, KEY_A).unwrap();
        let verifier = KnownHostsVerifier::new(path);
        assert!(verifier.verify("qb2", 22, &key(KEY_A)).is_ok());
        // Same key from a different host/port is NOT trusted.
        assert!(matches!(
            verifier.verify("other-host", 22, &key(KEY_A)),
            Err(SshError::UnknownHostKey { .. })
        ));
        assert!(matches!(
            verifier.verify("qb2", 2222, &key(KEY_A)),
            Err(SshError::UnknownHostKey { .. })
        ));
    }

    #[test]
    fn changed_key_is_a_hard_failure() {
        let (_dir, path) = temp_known_hosts();
        trust(&path, "qb2", 22, KEY_A).unwrap();
        let verifier = KnownHostsVerifier::new(path);
        let err = verifier.verify("qb2", 22, &key(KEY_B)).unwrap_err();
        assert!(matches!(err, SshError::ChangedHostKey { .. }), "{err:?}");
        assert!(err.is_fatal());
    }

    #[test]
    fn trust_rejects_garbage_keys() {
        let (_dir, path) = temp_known_hosts();
        let err = trust(&path, "qb2", 22, "not a key").unwrap_err();
        assert!(matches!(err, SshError::KnownHosts { .. }));
        assert!(!path.exists() || std::fs::read_to_string(&path).unwrap().is_empty());
    }

    #[test]
    fn trust_creates_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/config/known_hosts");
        trust(&path, "qb2", 22, KEY_A).unwrap();
        let verifier = KnownHostsVerifier::new(path);
        assert!(verifier.verify("qb2", 22, &key(KEY_A)).is_ok());
    }
}
