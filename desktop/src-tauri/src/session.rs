// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! What the last session was, so the next launch can pick it up.
//!
//! Everything the app knew about a live connection used to die with the
//! process (`state.rs`, `ssh/commands.rs` `TunnelState`), so quitting with a
//! stack still running on a QuietBox left no trace of it anywhere. This
//! module persists one small record — which machine, when, and whether we
//! believe we left the stack up — next to the other settings.
//!
//! `stack_left_running` is a *belief*, not a fact: by the next launch someone
//! else may have run `--stop`, or the box may have rebooted. It gates whether
//! resuming is worth attempting and what the banner says; only a live probe
//! decides what to do once connected.
//!
//! The resume attempt itself is one-shot per process ([`ResumeState`]). The
//! launcher UI is re-mounted several times in a single run — the `?quit=1`
//! prompt, the return-to-launcher on hard tunnel loss, the tray's "Switch
//! machine" — and a resume that fired on every mount would reconnect to the
//! machine whose tunnel just died, forever.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Wry};
use tauri_plugin_store::StoreExt;

use crate::profiles::{Profile, ProfileKind};
use crate::teardown::SessionKind;

const SETTINGS_STORE: &str = "settings.json";
const LAST_SESSION_KEY: &str = "last_session";
const RESUME_KEY: &str = "resume_on_launch";

/// Past this, a record is a stale souvenir rather than "where I was".
pub const RESUME_MAX_AGE_SECS: f64 = 12.0 * 3600.0;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LastSession {
    pub profile_id: String,
    /// Kept alongside the id so the resume banner can name the machine
    /// without waiting on the profile store.
    pub profile_name: String,
    /// Unix seconds of the last attach or exit.
    pub at: f64,
    /// Whether we left a stack running there. Advisory — see module docs.
    pub stack_left_running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
}

/// One resume attempt per process, however many times the launcher loads.
#[derive(Default)]
pub struct ResumeState {
    attempted: AtomicBool,
}

impl ResumeState {
    /// True the first time only.
    fn claim(&self) -> bool {
        !self.attempted.swap(true, Ordering::SeqCst)
    }

    #[cfg(test)]
    fn attempted(&self) -> bool {
        self.attempted.load(Ordering::SeqCst)
    }
}

/// The machine to resume to, handed to the frontend.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ResumePlan {
    pub profile: Profile,
    pub stack_left_running: bool,
    pub age_secs: f64,
}

/// Why a launch is not resuming. Serialized for logs and tests, not shown
/// to the user — the picker is a perfectly good "no resume" screen.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NoResumeReason {
    /// The user turned resume off.
    Disabled,
    /// This process already tried once.
    AlreadyAttempted,
    /// Nothing was ever recorded.
    NoRecord,
    /// The profile was deleted, or is no longer an SSH profile.
    ProfileGone,
    /// The stack was deliberately stopped on the way out.
    StackStopped,
    /// Older than [`RESUME_MAX_AGE_SECS`].
    Stale,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ResumeDecision {
    Resume(ResumePlan),
    None { reason: NoResumeReason },
}

// ---- pure decisions (unit-tested, no Tauri involved) ----

pub fn parse_last_session(value: Option<&serde_json::Value>) -> Option<LastSession> {
    // A corrupt record must land on the picker, never wedge the launch.
    value.and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Whether to resume, and to what. Precedence is deliberate: a user's opt-out
/// beats everything, and "already tried" beats a perfect record so a re-mount
/// can never re-fire.
pub fn decide_resume(
    last: Option<&LastSession>,
    profiles: &[Profile],
    enabled: bool,
    attempted: bool,
    now: f64,
) -> ResumeDecision {
    use NoResumeReason::*;
    let none = |reason| ResumeDecision::None { reason };

    if !enabled {
        return none(Disabled);
    }
    if attempted {
        return none(AlreadyAttempted);
    }
    let Some(last) = last else {
        return none(NoRecord);
    };
    let Some(profile) = profiles
        .iter()
        .find(|p| p.id == last.profile_id && p.kind == ProfileKind::Ssh)
    else {
        return none(ProfileGone);
    };
    if !last.stack_left_running {
        // Nothing to come back to: land on the picker with this machine
        // sorted first rather than dialing an idle box.
        return none(StackStopped);
    }
    let age = now - last.at;
    if age > RESUME_MAX_AGE_SECS {
        return none(Stale);
    }
    ResumeDecision::Resume(ResumePlan {
        profile: profile.clone(),
        stack_left_running: true,
        age_secs: age.max(0.0),
    })
}

/// The record to write as the process exits. `None` means "leave whatever is
/// there alone" — a local stack is not something this record describes.
pub fn exit_record(
    session: SessionKind,
    active: Option<&Profile>,
    previous: Option<&LastSession>,
    now: f64,
) -> Option<LastSession> {
    match session {
        SessionKind::LocalStack => None,
        SessionKind::SshActive => {
            let profile = active?;
            Some(LastSession {
                profile_id: profile.id.clone(),
                profile_name: profile.name.clone(),
                at: now,
                stack_left_running: true,
                repo_path: profile.remote_repo_path.clone(),
            })
        }
        // Disconnected before quitting: keep the record (which machine it was
        // is still useful) but stop claiming a stack is up there.
        SessionKind::Detached => previous.map(|prev| LastSession {
            stack_left_running: false,
            at: now,
            ..prev.clone()
        }),
    }
}

/// Whether deleting `deleted_id` invalidates the stored record.
pub fn clears_last_session(last: &LastSession, deleted_id: &str) -> bool {
    last.profile_id == deleted_id
}

// ---- persistence ----

pub(crate) fn stored_session(app: &tauri::AppHandle<Wry>) -> Option<LastSession> {
    let store = app.store(SETTINGS_STORE).ok()?;
    parse_last_session(store.get(LAST_SESSION_KEY).as_ref())
}

fn write_session(app: &tauri::AppHandle<Wry>, record: Option<&LastSession>) {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return;
    };
    match record {
        Some(record) => match serde_json::to_value(record) {
            Ok(value) => store.set(LAST_SESSION_KEY, value),
            Err(_) => return,
        },
        None => {
            store.delete(LAST_SESSION_KEY);
        }
    }
    let _ = store.save();
}

pub(crate) fn resume_enabled(app: &tauri::AppHandle<Wry>) -> bool {
    app.store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(RESUME_KEY))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Record that we just put a stack on screen. Called from `open_stack`,
/// which is the one definition of "attached" the app has.
pub(crate) fn record_attach(app: &tauri::AppHandle<Wry>) {
    let tunnels = app.state::<crate::ssh::commands::TunnelState>();
    let Some(profile) = tunnels.active_profile() else {
        return; // local stack: not something this record describes
    };
    write_session(
        app,
        Some(&LastSession {
            profile_id: profile.id.clone(),
            profile_name: profile.name.clone(),
            at: now_secs(),
            stack_left_running: true,
            repo_path: profile.remote_repo_path.clone(),
        }),
    );
}

/// The authoritative sweep on the way out. Runs inside the platform's
/// will-terminate callback, so it writes the store and does nothing else —
/// no SSH, no async. `record_attach` already wrote an eager record, so a
/// failure here leaves it stale rather than absent.
pub(crate) fn record_on_exit(app: &tauri::AppHandle<Wry>) {
    let tunnels = app.state::<crate::ssh::commands::TunnelState>();
    let previous = stored_session(app);
    let record = exit_record(
        crate::teardown::session_kind(app),
        tunnels.active_profile().as_ref(),
        previous.as_ref(),
        now_secs(),
    );
    if let Some(record) = record {
        write_session(app, Some(&record));
    }
}

/// Mark the stack as stopped without forgetting which machine it was on.
pub(crate) fn mark_stack_stopped(app: &tauri::AppHandle<Wry>) {
    if let Some(mut record) = stored_session(app) {
        record.stack_left_running = false;
        record.at = now_secs();
        write_session(app, Some(&record));
    }
}

/// Drop a stored record whose profile just went away.
pub(crate) fn forget_profile(app: &tauri::AppHandle<Wry>, deleted_id: &str) {
    if stored_session(app).is_some_and(|last| clears_last_session(&last, deleted_id)) {
        write_session(app, None);
    }
}

// ---- commands ----

/// The machine to resume to, or None. Named `take_` because it consumes the
/// process's single resume attempt: every later call returns None.
#[tauri::command]
pub fn take_resume_target(
    app: tauri::AppHandle<Wry>,
    state: tauri::State<'_, ResumeState>,
) -> Option<ResumePlan> {
    let profiles = crate::profiles::list_profiles(app.clone()).unwrap_or_default();
    let decision = decide_resume(
        stored_session(&app).as_ref(),
        &profiles,
        resume_enabled(&app),
        !state.claim(),
        now_secs(),
    );
    match decision {
        ResumeDecision::Resume(plan) => Some(plan),
        ResumeDecision::None { .. } => None,
    }
}

/// Forget the last session entirely (a resume that failed, so the next
/// launch starts clean instead of re-looping).
#[tauri::command]
pub fn clear_last_session(app: tauri::AppHandle<Wry>) -> Result<(), String> {
    write_session(&app, None);
    Ok(())
}

/// Stop auto-resuming to this machine, but remember it was the last one.
#[tauri::command]
pub fn suppress_resume(app: tauri::AppHandle<Wry>) -> Result<(), String> {
    mark_stack_stopped(&app);
    Ok(())
}

#[tauri::command]
pub fn get_resume_on_launch(app: tauri::AppHandle<Wry>) -> bool {
    resume_enabled(&app)
}

#[tauri::command]
pub fn set_resume_on_launch(app: tauri::AppHandle<Wry>, enabled: bool) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| e.to_string())?;
    store.set(RESUME_KEY, serde_json::Value::Bool(enabled));
    store.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ssh(id: &str) -> Profile {
        Profile {
            id: id.into(),
            name: "QuietBox".into(),
            kind: ProfileKind::Ssh,
            host: Some("qb2.lan".into()),
            port: None,
            user: Some("jashan".into()),
            auth: None,
            remote_repo_path: Some("~/tt-studio".into()),
            last_used: None,
        }
    }

    fn record(id: &str, at: f64, running: bool) -> LastSession {
        LastSession {
            profile_id: id.into(),
            profile_name: "QuietBox".into(),
            at,
            stack_left_running: running,
            repo_path: None,
        }
    }

    const NOW: f64 = 1_000_000.0;

    fn reason(d: ResumeDecision) -> Option<NoResumeReason> {
        match d {
            ResumeDecision::None { reason } => Some(reason),
            ResumeDecision::Resume(_) => None,
        }
    }

    #[test]
    fn resumes_a_fresh_record_for_a_live_profile() {
        let last = record("p1", NOW - 600.0, true);
        let decision = decide_resume(Some(&last), &[ssh("p1")], true, false, NOW);
        match decision {
            ResumeDecision::Resume(plan) => {
                assert_eq!(plan.profile.id, "p1");
                assert!(plan.stack_left_running);
                assert_eq!(plan.age_secs, 600.0);
            }
            other => panic!("expected a resume, got {other:?}"),
        }
    }

    #[test]
    fn every_no_resume_reason_is_reachable() {
        let fresh = record("p1", NOW, true);
        let profiles = [ssh("p1")];

        assert_eq!(
            reason(decide_resume(Some(&fresh), &profiles, false, false, NOW)),
            Some(NoResumeReason::Disabled)
        );
        assert_eq!(
            reason(decide_resume(Some(&fresh), &profiles, true, true, NOW)),
            Some(NoResumeReason::AlreadyAttempted)
        );
        assert_eq!(
            reason(decide_resume(None, &profiles, true, false, NOW)),
            Some(NoResumeReason::NoRecord)
        );
        assert_eq!(
            reason(decide_resume(Some(&fresh), &[], true, false, NOW)),
            Some(NoResumeReason::ProfileGone)
        );
        assert_eq!(
            reason(decide_resume(
                Some(&record("p1", NOW, false)),
                &profiles,
                true,
                false,
                NOW
            )),
            Some(NoResumeReason::StackStopped)
        );
        assert_eq!(
            reason(decide_resume(
                Some(&record("p1", NOW - RESUME_MAX_AGE_SECS - 1.0, true)),
                &profiles,
                true,
                false,
                NOW
            )),
            Some(NoResumeReason::Stale)
        );
    }

    #[test]
    fn precedence_holds_when_several_reasons_apply() {
        // A perfect record still loses to the opt-out, and "already tried"
        // still wins over everything below it.
        let fresh = record("p1", NOW, true);
        assert_eq!(
            reason(decide_resume(Some(&fresh), &[ssh("p1")], false, true, NOW)),
            Some(NoResumeReason::Disabled)
        );
        assert_eq!(
            reason(decide_resume(None, &[], true, true, NOW)),
            Some(NoResumeReason::AlreadyAttempted)
        );
    }

    #[test]
    fn staleness_boundary_is_inclusive() {
        let profiles = [ssh("p1")];
        let exactly = record("p1", NOW - RESUME_MAX_AGE_SECS, true);
        assert!(matches!(
            decide_resume(Some(&exactly), &profiles, true, false, NOW),
            ResumeDecision::Resume(_)
        ));
        let past = record("p1", NOW - RESUME_MAX_AGE_SECS - 0.5, true);
        assert_eq!(
            reason(decide_resume(Some(&past), &profiles, true, false, NOW)),
            Some(NoResumeReason::Stale)
        );
    }

    #[test]
    fn a_profile_flipped_to_local_is_gone_for_resume_purposes() {
        let mut local = ssh("p1");
        local.kind = ProfileKind::Local;
        assert_eq!(
            reason(decide_resume(
                Some(&record("p1", NOW, true)),
                &[local],
                true,
                false,
                NOW
            )),
            Some(NoResumeReason::ProfileGone)
        );
    }

    #[test]
    fn a_clock_that_went_backwards_never_yields_a_negative_age() {
        let future = record("p1", NOW + 30.0, true);
        match decide_resume(Some(&future), &[ssh("p1")], true, false, NOW) {
            ResumeDecision::Resume(plan) => assert_eq!(plan.age_secs, 0.0),
            other => panic!("expected a resume, got {other:?}"),
        }
    }

    #[test]
    fn exit_record_reflects_the_session_kind() {
        let profile = ssh("p1");
        let previous = record("p1", NOW - 5000.0, true);

        let ssh_active = exit_record(SessionKind::SshActive, Some(&profile), None, NOW).unwrap();
        assert!(ssh_active.stack_left_running);
        assert_eq!(ssh_active.profile_id, "p1");
        assert_eq!(ssh_active.repo_path.as_deref(), Some("~/tt-studio"));

        let detached =
            exit_record(SessionKind::Detached, None, Some(&previous), NOW).expect("keeps record");
        assert!(!detached.stack_left_running);
        assert_eq!(detached.profile_id, "p1");
        assert_eq!(detached.at, NOW);

        // A local stack is not what this record describes.
        assert_eq!(
            exit_record(
                SessionKind::LocalStack,
                Some(&profile),
                Some(&previous),
                NOW
            ),
            None
        );
        // Nothing to carry forward.
        assert_eq!(exit_record(SessionKind::Detached, None, None, NOW), None);
    }

    #[test]
    fn parse_tolerates_a_missing_or_corrupt_record() {
        assert_eq!(parse_last_session(None), None);
        assert_eq!(parse_last_session(Some(&serde_json::json!("nope"))), None);
        assert_eq!(
            parse_last_session(Some(&serde_json::json!({"profile_id": "p1"}))),
            None
        );
        let good = serde_json::json!({
            "profile_id": "p1",
            "profile_name": "QuietBox",
            "at": 12.0,
            "stack_left_running": true,
        });
        assert_eq!(
            parse_last_session(Some(&good)),
            Some(record("p1", 12.0, true))
        );
    }

    #[test]
    fn clears_only_the_matching_profile() {
        let last = record("p1", NOW, true);
        assert!(clears_last_session(&last, "p1"));
        assert!(!clears_last_session(&last, "p2"));
    }

    #[test]
    fn resume_state_can_only_be_claimed_once() {
        let state = ResumeState::default();
        assert!(state.claim());
        assert!(!state.claim());
        assert!(!state.claim());
        assert!(state.attempted());
    }

    #[test]
    fn record_round_trips_through_json() {
        let last = record("p1", 1.5, true);
        let json = serde_json::to_value(&last).unwrap();
        assert_eq!(json["stack_left_running"], true);
        assert!(json.get("repo_path").is_none(), "None is not serialized");
        assert_eq!(parse_last_session(Some(&json)), Some(last));
    }

    #[test]
    fn decisions_serialize_with_snake_case_discriminants() {
        let none = serde_json::to_value(ResumeDecision::None {
            reason: NoResumeReason::AlreadyAttempted,
        })
        .unwrap();
        assert_eq!(none["kind"], "none");
        assert_eq!(none["reason"], "already_attempted");

        let plan = serde_json::to_value(ResumeDecision::Resume(ResumePlan {
            profile: ssh("p1"),
            stack_left_running: true,
            age_secs: 3.0,
        }))
        .unwrap();
        assert_eq!(plan["kind"], "resume");
        assert_eq!(plan["profile"]["id"], "p1");
    }
}
