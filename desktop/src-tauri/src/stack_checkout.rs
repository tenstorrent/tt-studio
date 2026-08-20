// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Locating (or creating) the tt-studio checkout that native mode runs.
//!
//! Native white-box mode drives `python run.py` inside a real tt-studio
//! checkout. Resolution order:
//!
//! 1. A user-configured path (settings store) — must already be a checkout.
//! 2. The managed checkout at `~/.local/share/tt-studio/stack`.
//! 3. If neither exists, shallow-clone the latest `v*` release tag of
//!    tenstorrent/tt-studio into the managed location.
//!
//! A directory counts as a checkout when `run.py` sits at its root — that is
//! the entrypoint the launcher spawns, and `run.py` derives TT_STUDIO_ROOT
//! from its cwd.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Manager, Wry};
use tauri_plugin_store::StoreExt;

pub const REPO_URL: &str = "https://github.com/tenstorrent/tt-studio";
const SETTINGS_STORE: &str = "settings.json";
const STACK_PATH_KEY: &str = "stack_checkout_path";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckoutSource {
    /// The user pointed the app at an existing checkout.
    Configured,
    /// The managed checkout already existed.
    Managed,
    /// Freshly cloned into the managed location.
    Cloned,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct StackCheckout {
    pub path: PathBuf,
    pub source: CheckoutSource,
}

/// A directory is a usable checkout iff `run.py` sits at its root.
pub fn is_valid_checkout(path: &Path) -> bool {
    path.join("run.py").is_file()
}

/// Managed checkout location under the user's home directory.
pub fn managed_dir(home: &Path) -> PathBuf {
    home.join(".local")
        .join("share")
        .join("tt-studio")
        .join("stack")
}

/// Numeric components of a plain release tag (`v2.10.0` → `[2, 10, 0]`).
/// Pre-releases and anything non-numeric are rejected — the managed clone
/// should only ever track a real release.
fn release_tag_key(tag: &str) -> Option<Vec<u64>> {
    let rest = tag.strip_prefix('v')?;
    rest.split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect()
}

/// Pick the highest release tag out of `git ls-remote --tags` output.
pub fn latest_v_tag(ls_remote: &str) -> Option<String> {
    ls_remote
        .lines()
        .filter_map(|line| line.split('\t').nth(1))
        .filter_map(|r| r.strip_prefix("refs/tags/"))
        .filter(|tag| !tag.ends_with("^{}"))
        .filter_map(|tag| release_tag_key(tag).map(|key| (key, tag.to_string())))
        .max()
        .map(|(_, tag)| tag)
}

fn git(args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.first().unwrap_or(&""),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Find an existing checkout without touching the network. Used where a
/// clone would be inappropriate (e.g. deciding what `--stop` should run in).
pub fn existing(configured: Option<&Path>, managed: &Path) -> Option<PathBuf> {
    if let Some(path) = configured {
        if is_valid_checkout(path) {
            return Some(path.to_path_buf());
        }
    }
    is_valid_checkout(managed).then(|| managed.to_path_buf())
}

/// Resolve the checkout to run, cloning the latest release into `managed`
/// when nothing exists yet. Runs git synchronously — call off the main
/// thread.
pub fn resolve(
    configured: Option<&Path>,
    managed: &Path,
    repo_url: &str,
) -> Result<StackCheckout, String> {
    if let Some(path) = configured {
        // An explicit setting that doesn't point at a checkout is a user
        // error to surface, not something to silently fall through.
        if !is_valid_checkout(path) {
            return Err(format!(
                "configured stack path {} has no run.py — point the setting at a tt-studio checkout or clear it",
                path.display()
            ));
        }
        return Ok(StackCheckout {
            path: path.to_path_buf(),
            source: CheckoutSource::Configured,
        });
    }

    if is_valid_checkout(managed) {
        return Ok(StackCheckout {
            path: managed.to_path_buf(),
            source: CheckoutSource::Managed,
        });
    }

    let occupied = managed.is_dir()
        && managed
            .read_dir()
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(true);
    if occupied || managed.is_file() {
        return Err(format!(
            "{} exists but is not a tt-studio checkout (no run.py) — remove it or configure a checkout path",
            managed.display()
        ));
    }

    let tags = git(&["ls-remote", "--tags", repo_url])?;
    let tag =
        latest_v_tag(&tags).ok_or_else(|| format!("no release tags (v*) found at {repo_url}"))?;

    if let Some(parent) = managed.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let managed_str = managed
        .to_str()
        .ok_or_else(|| "managed checkout path is not valid UTF-8".to_string())?;
    git(&[
        "clone",
        "--depth",
        "1",
        "--branch",
        &tag,
        repo_url,
        managed_str,
    ])?;

    if !is_valid_checkout(managed) {
        return Err(format!(
            "cloned {tag} into {} but run.py is missing — clone looks broken",
            managed.display()
        ));
    }
    Ok(StackCheckout {
        path: managed.to_path_buf(),
        source: CheckoutSource::Cloned,
    })
}

// ---- Tauri commands ----

pub fn configured_path(app: &tauri::AppHandle<Wry>) -> Result<Option<PathBuf>, String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    Ok(store
        .get(STACK_PATH_KEY)
        .and_then(|v| v.as_str().map(PathBuf::from)))
}

fn default_managed_dir(app: &tauri::AppHandle<Wry>) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(managed_dir(&home))
}

/// Resolve (and if needed clone) the checkout native mode should use.
#[tauri::command]
pub async fn resolve_stack_checkout(app: tauri::AppHandle<Wry>) -> Result<StackCheckout, String> {
    let configured = configured_path(&app)?;
    let managed = default_managed_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || resolve(configured.as_deref(), &managed, REPO_URL))
        .await
        .map_err(|e| e.to_string())?
}

/// Set (or with `None`, clear) the user-configured checkout path.
#[tauri::command]
pub fn set_stack_checkout_path(
    app: tauri::AppHandle<Wry>,
    path: Option<String>,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    match path {
        Some(p) => {
            if !is_valid_checkout(Path::new(&p)) {
                return Err(format!("{p} is not a tt-studio checkout (no run.py)"));
            }
            store.set(STACK_PATH_KEY, serde_json::Value::String(p));
        }
        None => {
            store.delete(STACK_PATH_KEY);
        }
    }
    store.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn run(dir: &Path, cmd: &[&str]) {
        let output = Command::new(cmd[0])
            .args(&cmd[1..])
            .current_dir(dir)
            .output()
            .unwrap_or_else(|e| panic!("spawn {cmd:?}: {e}"));
        assert!(
            output.status.success(),
            "{cmd:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// Local bare repo with run.py, tagged v0.1.0 and (one commit later)
    /// v0.10.0, plus tags resolve() must ignore. Returns a clone URL.
    fn fixture_repo(base: &Path) -> String {
        let bare = base.join("origin.git");
        let work = base.join("work");
        fs::create_dir_all(&bare).unwrap();
        run(
            base,
            &["git", "init", "-q", "--bare", bare.to_str().unwrap()],
        );
        run(
            base,
            &[
                "git",
                "clone",
                "-q",
                bare.to_str().unwrap(),
                work.to_str().unwrap(),
            ],
        );
        run(&work, &["git", "config", "user.email", "ci@example.com"]);
        run(&work, &["git", "config", "user.name", "CI"]);
        fs::write(work.join("run.py"), "# release v0.1.0\n").unwrap();
        run(&work, &["git", "add", "run.py"]);
        run(&work, &["git", "commit", "-q", "-m", "v0.1.0"]);
        run(&work, &["git", "tag", "v0.1.0"]);
        run(&work, &["git", "tag", "v1.0.0-rc1"]); // pre-release: ignored
        run(&work, &["git", "tag", "not-a-version"]);
        fs::write(work.join("run.py"), "# release v0.10.0\n").unwrap();
        run(&work, &["git", "commit", "-q", "-am", "v0.10.0"]);
        run(&work, &["git", "tag", "v0.10.0"]);
        run(
            &work,
            &["git", "push", "-q", "--tags", "origin", "HEAD:main"],
        );
        bare.to_str().unwrap().to_string()
    }

    #[test]
    fn checkout_validity_hinges_on_run_py() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_valid_checkout(dir.path()));
        fs::write(dir.path().join("run.py"), "").unwrap();
        assert!(is_valid_checkout(dir.path()));
    }

    #[test]
    fn latest_tag_picks_highest_release_numerically() {
        let output = "\
aaa\trefs/tags/not-a-version
bbb\trefs/tags/v2.9.1
ccc\trefs/tags/v2.10.0
ccc\trefs/tags/v2.10.0^{}
ddd\trefs/tags/v2.10.0-rc1
eee\trefs/tags/v2.2.0
";
        assert_eq!(latest_v_tag(output).as_deref(), Some("v2.10.0"));
        assert_eq!(latest_v_tag(""), None);
        assert_eq!(latest_v_tag("aaa\trefs/tags/v3-rc"), None);
    }

    #[test]
    fn configured_checkout_wins_but_must_be_valid() {
        let dir = tempfile::tempdir().unwrap();
        let configured = dir.path().join("mine");
        fs::create_dir_all(&configured).unwrap();
        let managed = dir.path().join("managed");

        // Configured but missing run.py: hard error, no fallthrough.
        let err = resolve(Some(&configured), &managed, "unused").unwrap_err();
        assert!(err.contains("no run.py"), "{err}");

        fs::write(configured.join("run.py"), "").unwrap();
        let checkout = resolve(Some(&configured), &managed, "unused").unwrap();
        assert_eq!(checkout.source, CheckoutSource::Configured);
        assert_eq!(checkout.path, configured);
    }

    #[test]
    fn existing_managed_checkout_is_reused_without_git() {
        let dir = tempfile::tempdir().unwrap();
        let managed = dir.path().join("managed");
        fs::create_dir_all(&managed).unwrap();
        fs::write(managed.join("run.py"), "").unwrap();
        // repo_url is bogus on purpose — no network/git should be needed.
        let checkout = resolve(None, &managed, "file:///nonexistent").unwrap();
        assert_eq!(checkout.source, CheckoutSource::Managed);
        assert_eq!(existing(None, &managed), Some(managed));
    }

    #[test]
    fn occupied_non_checkout_managed_dir_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let managed = dir.path().join("managed");
        fs::create_dir_all(&managed).unwrap();
        fs::write(managed.join("junk.txt"), "").unwrap();
        let err = resolve(None, &managed, "unused").unwrap_err();
        assert!(err.contains("not a tt-studio checkout"), "{err}");
    }

    #[test]
    fn missing_managed_dir_clones_the_latest_release_tag() {
        let dir = tempfile::tempdir().unwrap();
        let url = fixture_repo(dir.path());
        let managed = dir.path().join("data").join("stack");

        let checkout = resolve(None, &managed, &url).unwrap();
        assert_eq!(checkout.source, CheckoutSource::Cloned);
        // v0.10.0 outranks v0.1.0 numerically (not lexically) and the
        // pre-release/junk tags were skipped.
        let contents = fs::read_to_string(managed.join("run.py")).unwrap();
        assert!(contents.contains("v0.10.0"), "{contents}");

        // A second resolve reuses the clone.
        let again = resolve(None, &managed, &url).unwrap();
        assert_eq!(again.source, CheckoutSource::Managed);
    }

    #[test]
    fn existing_prefers_configured_over_managed() {
        let dir = tempfile::tempdir().unwrap();
        let configured = dir.path().join("mine");
        let managed = dir.path().join("managed");
        for p in [&configured, &managed] {
            fs::create_dir_all(p).unwrap();
            fs::write(p.join("run.py"), "").unwrap();
        }
        assert_eq!(existing(Some(&configured), &managed), Some(configured));
        assert_eq!(
            existing(Some(Path::new("/nope")), &managed),
            Some(managed.clone())
        );
        assert_eq!(existing(None, Path::new("/nope")), None);
    }
}
