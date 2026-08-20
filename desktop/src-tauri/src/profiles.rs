// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Connection profiles for the desktop shell.
//!
//! A profile describes a machine that runs (or will run) a TT-Studio stack:
//! either this machine (`local`) or a remote one reached over SSH (`ssh`).
//! Profiles persist via tauri-plugin-store in `profiles.json` in the app
//! config dir. Secret material (passphrases, passwords) is never stored
//! here — see `secrets.rs` for the OS-keychain side.

use serde::{Deserialize, Serialize};
use tauri::Wry;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "profiles.json";
const PROFILES_KEY: &str = "profiles";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProfileKind {
    Local,
    Ssh,
}

/// How to authenticate an SSH profile. Key passphrases live in the OS
/// keychain keyed by profile id, never in the profile itself.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum SshAuth {
    Agent,
    Key { path: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub kind: ProfileKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<SshAuth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_repo_path: Option<String>,
    /// Unix seconds of the last successful connect, for sorting the picker.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used: Option<f64>,
}

// ---- pure CRUD over a profile list (unit-tested, no Tauri involved) ----

pub fn parse_profiles(value: Option<&serde_json::Value>) -> Vec<Profile> {
    // Tolerate a corrupt or missing store rather than wedging the picker.
    value
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

/// Insert or replace by id. New profiles append; existing ones keep position.
pub fn upsert(profiles: &mut Vec<Profile>, profile: Profile) {
    match profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(slot) => *slot = profile,
        None => profiles.push(profile),
    }
}

pub fn remove(profiles: &mut Vec<Profile>, id: &str) -> bool {
    let before = profiles.len();
    profiles.retain(|p| p.id != id);
    profiles.len() != before
}

pub fn touch(profiles: &mut [Profile], id: &str, now: f64) -> bool {
    match profiles.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.last_used = Some(now);
            true
        }
        None => false,
    }
}

/// Record the repo path a connect actually validated (found `run.py` at) so
/// later connects and the quit-time stop use it without re-deriving defaults.
pub fn set_repo_path(profiles: &mut [Profile], id: &str, path: &str) -> bool {
    match profiles.iter_mut().find(|p| p.id == id) {
        Some(p) if p.remote_repo_path.as_deref() != Some(path) => {
            p.remote_repo_path = Some(path.to_string());
            true
        }
        _ => false,
    }
}

/// Most-recently-used first; never-used profiles keep insertion order at the end.
pub fn sort_recent_first(profiles: &mut [Profile]) {
    profiles.sort_by(|a, b| {
        b.last_used
            .unwrap_or(0.0)
            .partial_cmp(&a.last_used.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

// ---- Tauri commands wiring the pure layer to tauri-plugin-store ----

fn read_store(app: &tauri::AppHandle<Wry>) -> Result<Vec<Profile>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    Ok(parse_profiles(store.get(PROFILES_KEY).as_ref()))
}

fn write_store(app: &tauri::AppHandle<Wry>, profiles: &[Profile]) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = serde_json::to_value(profiles).map_err(|e| e.to_string())?;
    store.set(PROFILES_KEY, value);
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_profiles(app: tauri::AppHandle<Wry>) -> Result<Vec<Profile>, String> {
    let mut profiles = read_store(&app)?;
    sort_recent_first(&mut profiles);
    Ok(profiles)
}

#[tauri::command]
pub fn save_profile(app: tauri::AppHandle<Wry>, profile: Profile) -> Result<Vec<Profile>, String> {
    if profile.id.trim().is_empty() {
        return Err("profile id must not be empty".to_string());
    }
    if profile.name.trim().is_empty() {
        return Err("profile name must not be empty".to_string());
    }
    let mut profiles = read_store(&app)?;
    upsert(&mut profiles, profile);
    write_store(&app, &profiles)?;
    Ok(profiles)
}

#[tauri::command]
pub fn delete_profile(app: tauri::AppHandle<Wry>, id: String) -> Result<Vec<Profile>, String> {
    let mut profiles = read_store(&app)?;
    remove(&mut profiles, &id);
    write_store(&app, &profiles)?;
    Ok(profiles)
}

/// Persist a validated repo path (no-op for unknown ids or unchanged paths).
pub fn persist_repo_path(app: &tauri::AppHandle<Wry>, id: &str, path: &str) -> Result<(), String> {
    let mut profiles = read_store(app)?;
    if set_repo_path(&mut profiles, id, path) {
        write_store(app, &profiles)?;
    }
    Ok(())
}

#[tauri::command]
pub fn mark_profile_used(app: tauri::AppHandle<Wry>, id: String) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs_f64();
    let mut profiles = read_store(&app)?;
    if touch(&mut profiles, &id, now) {
        write_store(&app, &profiles)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh_profile(id: &str, name: &str) -> Profile {
        Profile {
            id: id.to_string(),
            name: name.to_string(),
            kind: ProfileKind::Ssh,
            host: Some("qb2.example.com".to_string()),
            port: Some(22),
            user: Some("jashan".to_string()),
            auth: Some(SshAuth::Key {
                path: "~/.ssh/id_ed25519".to_string(),
            }),
            remote_repo_path: Some("~/tt-studio".to_string()),
            last_used: None,
        }
    }

    #[test]
    fn profile_round_trips_through_json() {
        let profile = ssh_profile("p1", "QuietBox");
        let json = serde_json::to_value(&profile).unwrap();
        assert_eq!(json["kind"], "ssh");
        assert_eq!(json["auth"]["method"], "key");
        assert_eq!(json["auth"]["path"], "~/.ssh/id_ed25519");
        let back: Profile = serde_json::from_value(json).unwrap();
        assert_eq!(back, profile);
    }

    #[test]
    fn local_profile_omits_ssh_fields() {
        let profile = Profile {
            id: "local".to_string(),
            name: "This machine".to_string(),
            kind: ProfileKind::Local,
            host: None,
            port: None,
            user: None,
            auth: None,
            remote_repo_path: None,
            last_used: None,
        };
        let json = serde_json::to_value(&profile).unwrap();
        assert!(json.get("host").is_none());
        assert!(json.get("auth").is_none());
        let back: Profile = serde_json::from_value(json).unwrap();
        assert_eq!(back, profile);
    }

    #[test]
    fn agent_auth_round_trips() {
        let json = serde_json::json!({ "method": "agent" });
        let auth: SshAuth = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(auth, SshAuth::Agent);
        assert_eq!(serde_json::to_value(&auth).unwrap(), json);
    }

    #[test]
    fn parse_profiles_tolerates_missing_and_corrupt_values() {
        assert!(parse_profiles(None).is_empty());
        assert!(parse_profiles(Some(&serde_json::json!("not a list"))).is_empty());
        assert!(parse_profiles(Some(&serde_json::json!([{ "bogus": true }]))).is_empty());
        let good = serde_json::to_value(vec![ssh_profile("p1", "QuietBox")]).unwrap();
        assert_eq!(parse_profiles(Some(&good)).len(), 1);
    }

    #[test]
    fn upsert_appends_new_and_replaces_existing() {
        let mut profiles = vec![];
        upsert(&mut profiles, ssh_profile("p1", "QuietBox"));
        upsert(&mut profiles, ssh_profile("p2", "Lab box"));
        assert_eq!(profiles.len(), 2);
        upsert(&mut profiles, ssh_profile("p1", "QuietBox (renamed)"));
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].name, "QuietBox (renamed)");
    }

    #[test]
    fn remove_deletes_by_id() {
        let mut profiles = vec![ssh_profile("p1", "a"), ssh_profile("p2", "b")];
        assert!(remove(&mut profiles, "p1"));
        assert_eq!(profiles.len(), 1);
        assert!(!remove(&mut profiles, "nope"));
        assert_eq!(profiles.len(), 1);
    }

    #[test]
    fn touch_sets_last_used_only_for_known_ids() {
        let mut profiles = vec![ssh_profile("p1", "a")];
        assert!(touch(&mut profiles, "p1", 1000.0));
        assert_eq!(profiles[0].last_used, Some(1000.0));
        assert!(!touch(&mut profiles, "ghost", 2000.0));
    }

    #[test]
    fn set_repo_path_updates_only_on_change() {
        let mut profiles = vec![ssh_profile("p1", "a")];
        // ssh_profile seeds "~/tt-studio"; same value is a no-op.
        assert!(!set_repo_path(&mut profiles, "p1", "~/tt-studio"));
        assert!(set_repo_path(&mut profiles, "p1", "/opt/tt-studio"));
        assert_eq!(
            profiles[0].remote_repo_path.as_deref(),
            Some("/opt/tt-studio")
        );
        assert!(!set_repo_path(&mut profiles, "ghost", "/x"));
    }

    #[test]
    fn sort_puts_most_recent_first() {
        let mut profiles = vec![
            ssh_profile("never", "never used"),
            ssh_profile("old", "old"),
            ssh_profile("new", "new"),
        ];
        touch(&mut profiles, "old", 100.0);
        touch(&mut profiles, "new", 200.0);
        sort_recent_first(&mut profiles);
        let ids: Vec<&str> = profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["new", "old", "never"]);
    }
}
