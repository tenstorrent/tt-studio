// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Stack freshness: is the target checkout on the latest `v*` release?
//!
//! Before a bring-up, the app compares the checkout's release tag (local:
//! git in the managed checkout; remote: `git -C <path> …` over ssh exec)
//! against the latest `v*` tag on origin, and decides whether to run the
//! guarded `run.py --switch <tag>` first. Releases — not raw main — are the
//! update target because .github/workflows/publish-images.yml only publishes
//! GHCR images on `v*` tags; following main would force local image builds.
//!
//! Two hard rules, mirrored from `tt_setup/switch.py`:
//! - `--switch` REFUSES dirty trees. The app never forces or resets — a
//!   dirty (or non-release) checkout is a developer checkout: skip the
//!   update and say so.
//! - Any failure to learn the latest tag (offline, rate limit) skips the
//!   update and proceeds to bring-up. Updates are best-effort; connecting
//!   is the job.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::Wry;
use tauri_plugin_store::StoreExt;

use crate::profiles::Profile;
use crate::ssh::exec::quote_path;
use crate::ssh::SshTransport;
use crate::stack_checkout::{self, release_tag_key};

/// Settings-store key for the user's update policy.
const POLICY_KEY: &str = "stack_update_policy";
const SETTINGS_STORE: &str = "settings.json";

/// What the user wants done when the stack is behind a release.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePolicy {
    /// Switch without asking.
    Auto,
    /// Ask before switching (default).
    #[default]
    Prompt,
    /// Never switch; always go straight to bring-up.
    Never,
}

/// What could be learned about the target checkout's git state.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CheckoutRef {
    /// The exact `v*` release tag HEAD sits on, when it does.
    pub tag: Option<String>,
    /// Tracked files modified (same test `run.py --switch` refuses on).
    pub dirty: bool,
    /// Human label for display: tag, `describe` output, or short sha.
    pub label: String,
}

/// Why an update was skipped (feeds the UI's info card).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    UpToDate,
    /// Local changes — `run.py --switch` would refuse; never force.
    DirtyCheckout,
    /// Clean but not on a `v*` tag (branch / detached sha): a developer
    /// checkout the app must not move.
    NotOnRelease,
    /// Couldn't learn the latest release tag — proceed without updating.
    Offline,
    PolicyNever,
    /// Nothing checked out yet; first use clones the latest release anyway.
    NoCheckout,
}

/// The decision for this connect, serialized for the launcher UI.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum StackUpdateAction {
    /// Run `run.py --switch <to>` now, then bring up.
    Update { from: String, to: String },
    /// Offer the switch and let the user decide (policy = prompt).
    Ask { from: String, to: String },
    /// Go straight to bring-up.
    Skip { reason: SkipReason },
}

/// Everything the UI needs to render the freshness outcome.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct StackFreshness {
    pub current: Option<CheckoutRef>,
    pub latest_tag: Option<String>,
    #[serde(flatten)]
    pub decision: StackUpdateAction,
}

// ---- pure logic ----

/// Fold raw git output into a [`CheckoutRef`]. `describe_exact` is the
/// stdout of `git describe --tags --exact-match` when it succeeded;
/// `porcelain` is `git status --porcelain --untracked-files=no` output.
pub fn checkout_ref(describe_exact: Option<&str>, porcelain: &str, label: &str) -> CheckoutRef {
    let exact = describe_exact.map(str::trim).filter(|t| !t.is_empty());
    // Only numeric v* tags count as releases — an exact match on some other
    // tag is still a developer checkout.
    let tag = exact
        .filter(|t| release_tag_key(t).is_some())
        .map(String::from);
    let label = exact
        .or_else(|| Some(label.trim()).filter(|l| !l.is_empty()))
        .unwrap_or("(unknown)")
        .to_string();
    CheckoutRef {
        tag,
        dirty: !porcelain.trim().is_empty(),
        label,
    }
}

/// The decision function: current ref × latest tag × policy → action.
/// Pure so the whole matrix is unit-testable.
pub fn decide(
    current: Option<&CheckoutRef>,
    latest: Option<&str>,
    policy: UpdatePolicy,
) -> StackUpdateAction {
    let Some(current) = current else {
        return StackUpdateAction::Skip {
            reason: SkipReason::NoCheckout,
        };
    };
    if current.dirty {
        return StackUpdateAction::Skip {
            reason: SkipReason::DirtyCheckout,
        };
    }
    let Some(tag) = &current.tag else {
        return StackUpdateAction::Skip {
            reason: SkipReason::NotOnRelease,
        };
    };
    let Some(latest) = latest else {
        return StackUpdateAction::Skip {
            reason: SkipReason::Offline,
        };
    };
    if release_tag_key(tag) >= release_tag_key(latest) {
        return StackUpdateAction::Skip {
            reason: SkipReason::UpToDate,
        };
    }
    match policy {
        UpdatePolicy::Never => StackUpdateAction::Skip {
            reason: SkipReason::PolicyNever,
        },
        UpdatePolicy::Auto => StackUpdateAction::Update {
            from: tag.clone(),
            to: latest.to_string(),
        },
        UpdatePolicy::Prompt => StackUpdateAction::Ask {
            from: tag.clone(),
            to: latest.to_string(),
        },
    }
}

// ---- the exact git commands, shared by the local and ssh paths ----

pub fn describe_exact_command(path: &str) -> String {
    format!("git -C {} describe --tags --exact-match", quote_path(path))
}

pub fn dirty_command(path: &str) -> String {
    format!(
        "git -C {} status --porcelain --untracked-files=no",
        quote_path(path)
    )
}

pub fn label_command(path: &str) -> String {
    format!("git -C {} describe --tags --always", quote_path(path))
}

// ---- gathering: local checkout ----

fn git_in(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Read the git state of a local checkout. Errors only when even
/// `git status` fails (not a repo, git missing).
pub fn local_checkout_ref(dir: &Path) -> Result<CheckoutRef, String> {
    let porcelain = git_in(dir, &["status", "--porcelain", "--untracked-files=no"])
        .map_err(|e| format!("couldn't inspect {}: {e}", dir.display()))?;
    let exact = git_in(dir, &["describe", "--tags", "--exact-match"]).ok();
    let label = git_in(dir, &["describe", "--tags", "--always"]).unwrap_or_default();
    Ok(checkout_ref(exact.as_deref(), &porcelain, &label))
}

/// Latest `v*` release tag on the repo, straight from `git ls-remote`
/// (system git handles auth/proxy/TLS the same way the clone did). `None`
/// means "couldn't learn it" — offline, no tags — and skips the update.
pub fn latest_release_tag(repo_url: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["ls-remote", "--tags", repo_url])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    stack_checkout::latest_v_tag(&String::from_utf8_lossy(&output.stdout))
}

// ---- gathering: remote checkout over ssh exec ----

async fn remote_checkout_ref(
    session: &crate::ssh::session::SshSession,
    path: &str,
) -> Result<CheckoutRef, crate::ssh::SshError> {
    let porcelain = session.exec_capture(&dirty_command(path)).await?;
    let exact = session.exec_capture(&describe_exact_command(path)).await?;
    let label = session.exec_capture(&label_command(path)).await?;
    Ok(checkout_ref(
        exact.success().then_some(exact.stdout.as_str()),
        // A failed status probe reads as clean here; the real guard is
        // run.py --switch itself, which re-checks and refuses dirty trees.
        if porcelain.success() {
            porcelain.stdout.as_str()
        } else {
            ""
        },
        label.stdout.trim(),
    ))
}

// ---- running the switch itself ----

/// Raw output lines from `run.py --switch`, streamed to the launcher UI
/// (rich renders plain when stdout is a pipe, so lines arrive clean).
pub const SWITCH_LINE_EVENT: &str = "switch-line";

/// Local spawn spec for `run.py --switch <tag>` inside the checkout.
pub fn switch_spec(
    checkout: &Path,
    tag: &str,
    stderr_log: std::path::PathBuf,
) -> crate::launcher::SpawnSpec {
    crate::launcher::SpawnSpec {
        program: "python3".to_string(),
        args: vec!["run.py".to_string(), "--switch".to_string(), tag.to_string()],
        cwd: checkout.to_path_buf(),
        stderr_log,
        envs: Vec::new(),
    }
}

/// The same switch over ssh exec. `2>&1` so progress and failure panels
/// both arrive on the streamed channel.
pub fn switch_command(path: &str, tag: &str) -> String {
    format!(
        "cd {} && python3 run.py --switch {tag} 2>&1",
        quote_path(path)
    )
}

/// Run the guarded `run.py --switch <tag>` on the connect target and stream
/// its output as `switch-line` events. Resolves once the switch finishes;
/// a non-zero exit is an error (the caller proceeds to bring-up on the old
/// version and says so). `--switch` re-checks the dirty-tree guard itself —
/// this never forces anything.
#[tauri::command]
pub async fn run_stack_switch(
    app: tauri::AppHandle<Wry>,
    launcher_state: tauri::State<'_, crate::state::LauncherState>,
    profile: Option<Profile>,
    tag: String,
) -> Result<(), String> {
    use tauri::Emitter;

    // The tag goes into a shell command on the ssh path and an argv here —
    // only accept what we'd have decided on: a plain numeric v* tag.
    if release_tag_key(&tag).is_none() {
        return Err(format!("{tag} is not a release tag (v*)"));
    }

    match profile {
        None => {
            let configured = stack_checkout::configured_path(&app)?;
            let managed = stack_checkout::default_managed_dir(&app)?;
            let dir = stack_checkout::existing(configured.as_deref(), &managed)
                .ok_or_else(|| "no local stack checkout to update".to_string())?;
            let spec = switch_spec(&dir, &tag, crate::launcher::log_dir(&app)?.join("switch.log"));

            let (tx, rx) = std::sync::mpsc::channel();
            let line_app = app.clone();
            crate::launcher::spawn_streaming(
                &spec,
                launcher_state.child.clone(),
                move |line| {
                    let _ = line_app.emit(SWITCH_LINE_EVENT, &line);
                },
                move |code| {
                    let _ = tx.send(code);
                },
            )?;
            let code = tauri::async_runtime::spawn_blocking(move || rx.recv())
                .await
                .map_err(|e| e.to_string())?
                .map_err(|_| "run.py --switch ended without an exit code".to_string())?;
            if code != Some(0) {
                return Err(format!(
                    "run.py --switch {tag} failed (exit {})",
                    code.map_or("signal".to_string(), |c| c.to_string())
                ));
            }
            Ok(())
        }
        Some(profile) => {
            let session = crate::remote::connect_session(&app, &profile)
                .await
                .map_err(|e| e.to_string())?;
            let command = switch_command(&crate::remote::repo_path(&profile), &tag);
            let line_app = app.clone();
            let result = session
                .exec_stream(
                    &command,
                    |line| {
                        let _ = line_app.emit(SWITCH_LINE_EVENT, line);
                    },
                    |_stderr| {},
                )
                .await;
            session.close().await;
            let code = result.map_err(|e| e.to_string())?;
            if code != Some(0) {
                return Err(format!(
                    "run.py --switch {tag} failed on the remote machine (exit {})",
                    code.map_or("unknown".to_string(), |c| c.to_string())
                ));
            }
            Ok(())
        }
    }
}

// ---- Tauri commands ----

pub fn stored_policy(app: &tauri::AppHandle<Wry>) -> Result<UpdatePolicy, String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    Ok(store
        .get(POLICY_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn get_stack_update_policy(app: tauri::AppHandle<Wry>) -> Result<UpdatePolicy, String> {
    stored_policy(&app)
}

#[tauri::command]
pub fn set_stack_update_policy(
    app: tauri::AppHandle<Wry>,
    policy: UpdatePolicy,
) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    store.set(
        POLICY_KEY,
        serde_json::to_value(policy).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())
}

/// Check whether the connect target's stack is behind the latest release.
/// `profile` = None means the local (native-mode) checkout; a profile means
/// its remote checkout, probed over ssh exec. Never blocks a connect: every
/// unknowable falls out as a Skip decision or an error the caller treats
/// the same way.
#[tauri::command]
pub async fn check_stack_freshness(
    app: tauri::AppHandle<Wry>,
    profile: Option<Profile>,
) -> Result<StackFreshness, String> {
    let policy = stored_policy(&app)?;

    let current = match &profile {
        None => {
            let configured = stack_checkout::configured_path(&app)?;
            let managed = stack_checkout::default_managed_dir(&app)?;
            match stack_checkout::existing(configured.as_deref(), &managed) {
                Some(dir) => Some(
                    tauri::async_runtime::spawn_blocking(move || local_checkout_ref(&dir))
                        .await
                        .map_err(|e| e.to_string())??,
                ),
                None => None,
            }
        }
        Some(profile) => {
            let session = crate::remote::connect_session(&app, profile)
                .await
                .map_err(|e| e.to_string())?;
            let path = crate::remote::repo_path(profile);
            let result = remote_checkout_ref(&session, &path).await;
            session.close().await;
            Some(result.map_err(|e| e.to_string())?)
        }
    };

    // The latest tag always comes from origin as seen from the app's host —
    // it's about what has been released, not what the target machine knows.
    let latest =
        tauri::async_runtime::spawn_blocking(|| latest_release_tag(stack_checkout::REPO_URL))
            .await
            .map_err(|e| e.to_string())?;

    let decision = decide(current.as_ref(), latest.as_deref(), policy);
    Ok(StackFreshness {
        current,
        latest_tag: latest,
        decision,
    })
}
