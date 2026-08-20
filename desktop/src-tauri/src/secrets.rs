// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! OS-keychain storage for SSH key passphrases.
//!
//! The only secret the desktop shell ever persists is the passphrase of an
//! SSH private key, keyed by connection-profile id. Passwords are never
//! persisted anywhere. On platforms without a usable keychain (e.g. headless
//! Linux with no secret-service daemon) every operation degrades to a typed
//! `keychain_unavailable` error the UI can explain instead of crashing.

use serde::Serialize;

const SERVICE: &str = "com.tenstorrent.tt-studio";

/// Typed error surfaced to the UI. `code` tells the frontend which case it
/// is; `message` carries platform detail for display/logging.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SecretError {
    /// No keychain backend is reachable (headless Linux without a
    /// secret-service daemon, locked keychain, etc.). The UI should offer
    /// ssh-agent auth or per-session passphrase entry instead.
    KeychainUnavailable {
        message: String,
    },
    NotFound,
    Other {
        message: String,
    },
}

impl From<keyring::Error> for SecretError {
    fn from(err: keyring::Error) -> Self {
        match err {
            keyring::Error::NoEntry => SecretError::NotFound,
            keyring::Error::NoStorageAccess(e) => SecretError::KeychainUnavailable {
                message: e.to_string(),
            },
            keyring::Error::PlatformFailure(e) => SecretError::KeychainUnavailable {
                message: e.to_string(),
            },
            other => SecretError::Other {
                message: other.to_string(),
            },
        }
    }
}

fn entry_for(profile_id: &str) -> Result<keyring::Entry, SecretError> {
    // One keychain entry per profile; the profile id is not secret.
    keyring::Entry::new(SERVICE, &format!("ssh-key-passphrase:{profile_id}"))
        .map_err(SecretError::from)
}

pub fn store_passphrase(profile_id: &str, passphrase: &str) -> Result<(), SecretError> {
    entry_for(profile_id)?
        .set_password(passphrase)
        .map_err(SecretError::from)
}

pub fn load_passphrase(profile_id: &str) -> Result<String, SecretError> {
    entry_for(profile_id)?
        .get_password()
        .map_err(SecretError::from)
}

pub fn forget_passphrase(profile_id: &str) -> Result<(), SecretError> {
    match entry_for(profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SecretError::from(e)),
    }
}

// ---- Tauri commands ----
//
// The passphrase is write-only from the UI's point of view: the frontend can
// set, clear, and probe existence, but never read it back — only the future
// SSH connector (Rust side) consumes it via `load_passphrase`.

#[tauri::command]
pub fn set_ssh_key_passphrase(profile_id: String, passphrase: String) -> Result<(), SecretError> {
    store_passphrase(&profile_id, &passphrase)
}

#[tauri::command]
pub fn clear_ssh_key_passphrase(profile_id: String) -> Result<(), SecretError> {
    forget_passphrase(&profile_id)
}

#[tauri::command]
pub fn has_ssh_key_passphrase(profile_id: String) -> Result<bool, SecretError> {
    match load_passphrase(&profile_id) {
        Ok(_) => Ok(true),
        Err(SecretError::NotFound) => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    use keyring::credential::{Credential, CredentialApi, CredentialBuilderApi};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Shared in-memory credential store so tests never touch (or require) a
    /// real keychain daemon. keyring's built-in mock keeps state per Entry,
    /// which can't exercise our create-entry-per-call functions.
    static VAULT: Mutex<Option<HashMap<(String, String), String>>> = Mutex::new(None);

    #[derive(Debug)]
    struct MemCredential {
        service: String,
        user: String,
    }

    impl CredentialApi for MemCredential {
        fn set_password(&self, password: &str) -> keyring::Result<()> {
            let mut vault = VAULT.lock().unwrap();
            vault
                .get_or_insert_with(HashMap::new)
                .insert((self.service.clone(), self.user.clone()), password.into());
            Ok(())
        }

        fn get_password(&self) -> keyring::Result<String> {
            let vault = VAULT.lock().unwrap();
            vault
                .as_ref()
                .and_then(|v| v.get(&(self.service.clone(), self.user.clone())))
                .cloned()
                .ok_or(keyring::Error::NoEntry)
        }

        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.set_password(&String::from_utf8_lossy(secret))
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.get_password().map(String::into_bytes)
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            let mut vault = VAULT.lock().unwrap();
            vault
                .get_or_insert_with(HashMap::new)
                .remove(&(self.service.clone(), self.user.clone()))
                .map(|_| ())
                .ok_or(keyring::Error::NoEntry)
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    #[derive(Debug)]
    struct MemBuilder;

    impl CredentialBuilderApi for MemBuilder {
        fn build(
            &self,
            _target: Option<&str>,
            service: &str,
            user: &str,
        ) -> keyring::Result<Box<Credential>> {
            Ok(Box::new(MemCredential {
                service: service.into(),
                user: user.into(),
            }))
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    fn use_mock_keyring() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            keyring::set_default_credential_builder(Box::new(MemBuilder));
        });
    }

    #[test]
    fn passphrase_round_trip_and_forget() {
        use_mock_keyring();
        store_passphrase("p1", "hunter2").unwrap();
        assert_eq!(load_passphrase("p1").unwrap(), "hunter2");
        forget_passphrase("p1").unwrap();
        assert_eq!(load_passphrase("p1"), Err(SecretError::NotFound));
    }

    #[test]
    fn forget_is_idempotent_for_missing_entries() {
        use_mock_keyring();
        assert_eq!(forget_passphrase("never-stored"), Ok(()));
    }

    #[test]
    fn entries_are_scoped_per_profile() {
        use_mock_keyring();
        store_passphrase("a", "secret-a").unwrap();
        store_passphrase("b", "secret-b").unwrap();
        assert_eq!(load_passphrase("a").unwrap(), "secret-a");
        assert_eq!(load_passphrase("b").unwrap(), "secret-b");
        forget_passphrase("a").unwrap();
        assert_eq!(load_passphrase("b").unwrap(), "secret-b");
    }

    #[test]
    fn keyring_errors_map_to_typed_errors() {
        assert_eq!(
            SecretError::from(keyring::Error::NoEntry),
            SecretError::NotFound
        );
        let unavailable = SecretError::from(keyring::Error::NoStorageAccess(
            "no secret-service daemon".into(),
        ));
        assert!(matches!(
            unavailable,
            SecretError::KeychainUnavailable { .. }
        ));
        // Serialized shape is the UI contract: a discriminant the frontend
        // can switch on plus a human message.
        let json = serde_json::to_value(&unavailable).unwrap();
        assert_eq!(json["code"], "keychain_unavailable");
        assert!(json["message"].as_str().unwrap().contains("daemon"));
        assert_eq!(
            serde_json::to_value(SecretError::NotFound).unwrap()["code"],
            "not_found"
        );
    }
}
