// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Remote TT-Studio stack detection over an established SSH tunnel set.
//!
//! Once the tunnels are up (all local listeners bound the stack's real
//! ports), the connect flow asks one question: attach to a running stack, or
//! bring one up? Answered by combining
//!
//! - the local health poller aimed at the forwarded ports (a healthy answer
//!   means the remote stack is fully up — attach), and
//! - one-shot probes over `ssh exec`: `test -f <repo>/run.py` (is there a
//!   checkout at the profile's repo path?), `python3 --version` (can run.py
//!   even run there?), and `python3 run.py --status --json` (which services
//!   are up — distinguishes down from partial).
//!
//! NOTE: callers must verify the tunnel's forwards actually bound before
//! classifying — with port 3000 taken locally, the health poll would be
//! talking to whatever local server squats on it, not the remote stack.

use serde::Serialize;
use tauri::Manager;

use crate::health;
use crate::profiles::Profile;
use crate::ssh::exec::{quote_path, ExecOutput};
use crate::ssh::known_hosts::KnownHostsVerifier;
use crate::ssh::session::SshSession;
use crate::ssh::{SshError, SshTransport};

/// Where a checkout lives when the profile doesn't say.
pub const DEFAULT_REPO_PATH: &str = "~/tt-studio";

/// `run.py` needs a modern interpreter; older ones fail with a confusing
/// SyntaxError instead of a clear message, so we gate up front.
pub const MIN_PYTHON: (u32, u32) = (3, 12);

/// The repo path this profile's stack lives at (falls back to the default).
pub fn repo_path(profile: &Profile) -> String {
    profile
        .remote_repo_path
        .clone()
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_REPO_PATH.to_string())
}

// ---- the exact commands run on the remote machine ----

pub fn probe_run_py_command(path: &str) -> String {
    format!("test -f {}/run.py", quote_path(path))
}

/// `2>&1` because some interpreters print the version banner to stderr.
pub fn python_version_command() -> &'static str {
    "python3 --version 2>&1"
}

pub fn status_command(path: &str) -> String {
    format!("cd {} && python3 run.py --status --json", quote_path(path))
}

/// `accept_terms` passes `--accept-terms`, the launcher's own flag for
/// agreeing to the OS Model Terms non-interactively. It is only ever set
/// after the user agreed in the app: `--json-events` turns that prompt into
/// a `prompt_blocked` event, and answering a legal question on someone's
/// behalf to get past it would not be acceptable.
pub fn bring_up_command(path: &str, accept_terms: bool) -> String {
    format!(
        "cd {} && python3 run.py --no-browser --json-events{}",
        quote_path(path),
        if accept_terms { " --accept-terms" } else { "" }
    )
}

pub fn stop_command(path: &str) -> String {
    format!("cd {} && python3 run.py --stop 2>&1", quote_path(path))
}

// ---- probe parsing ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PythonProbe {
    Found { major: u32, minor: u32, raw: String },
    Missing { message: String },
}

impl PythonProbe {
    pub fn meets_minimum(&self) -> bool {
        matches!(self, PythonProbe::Found { major, minor, .. }
            if (*major, *minor) >= MIN_PYTHON)
    }
}

/// Interpret `python3 --version 2>&1` output. A non-zero exit is "no usable
/// python3" (127 from the shell when the binary is absent).
pub fn parse_python_probe(output: &ExecOutput) -> PythonProbe {
    let raw = output.stdout.trim().to_string();
    if !output.success() {
        return PythonProbe::Missing {
            message: if raw.is_empty() {
                "python3 not found on the remote machine".to_string()
            } else {
                raw
            },
        };
    }
    let mut parts = raw
        .strip_prefix("Python ")
        .unwrap_or("")
        .split('.')
        .map(|p| p.parse::<u32>());
    match (parts.next(), parts.next()) {
        (Some(Ok(major)), Some(Ok(minor))) => PythonProbe::Found { major, minor, raw },
        _ => PythonProbe::Missing {
            message: format!("could not parse python version from {raw:?}"),
        },
    }
}

/// One service row from the `status` event of `run.py --status --json`.
pub type ServiceUp = (String, bool);

/// Pull the service list out of a `--status --json` stdout dump: NDJSON
/// lines, one of which is the `status` event. Unparseable lines are skipped
/// (same contract as the frontend's event parser).
pub fn parse_status_services(stdout: &str) -> Option<Vec<ServiceUp>> {
    for line in stdout.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value["event"] != "status" {
            continue;
        }
        let services = value["detail"]["services"].as_array()?;
        return Some(
            services
                .iter()
                .filter_map(|s| {
                    Some((
                        s["name"].as_str()?.to_string(),
                        s["healthy"].as_bool().unwrap_or(false),
                    ))
                })
                .collect(),
        );
    }
    None
}

// ---- classification ----

/// What the connect flow should do next, serialized for the launcher UI
/// (tagged the same way as `SshError`).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StackClassification {
    /// Every service answers over the tunnel — attach directly.
    Healthy,
    /// Some services are up; bring-up will finish the job.
    Partial {
        healthy: Vec<String>,
        unhealthy: Vec<String>,
    },
    /// Nothing is running — full bring-up.
    Down,
    /// No `run.py` at the profile's repo path: the UI shows clone
    /// instructions (remote auto-clone is out of scope).
    NoCheckout { path: String },
    /// No usable python3 on the remote machine.
    PythonMissing { message: String },
    /// python3 exists but is older than run.py supports.
    PythonTooOld { found: String, required: String },
}

impl StackClassification {
    /// True when the right next step is running the bring-up command.
    pub fn needs_bring_up(&self) -> bool {
        matches!(
            self,
            StackClassification::Partial { .. } | StackClassification::Down
        )
    }
}

/// Pure decision over the probe results (unit-tested; the Tauri command and
/// the e2e test both feed it real probes).
pub fn classify(
    local_ready: bool,
    run_py_exists: bool,
    python: &PythonProbe,
    services: Option<&[ServiceUp]>,
    path: &str,
) -> StackClassification {
    if local_ready {
        // The stack answers end to end through the tunnel; nothing else
        // matters (an old python can't stop an already-running stack).
        return StackClassification::Healthy;
    }
    if !run_py_exists {
        return StackClassification::NoCheckout {
            path: path.to_string(),
        };
    }
    match python {
        PythonProbe::Missing { message } => {
            return StackClassification::PythonMissing {
                message: message.clone(),
            }
        }
        PythonProbe::Found { raw, .. } if !python.meets_minimum() => {
            return StackClassification::PythonTooOld {
                found: raw.clone(),
                required: format!("{}.{}", MIN_PYTHON.0, MIN_PYTHON.1),
            }
        }
        PythonProbe::Found { .. } => {}
    }
    let (healthy, unhealthy): (Vec<_>, Vec<_>) = services
        .unwrap_or(&[])
        .iter()
        .cloned()
        .partition(|(_, up)| *up);
    if healthy.is_empty() {
        // Also the fallback when --status --json isn't available on the
        // remote checkout: bring-up sorts that out either way.
        StackClassification::Down
    } else {
        StackClassification::Partial {
            healthy: healthy.into_iter().map(|(n, _)| n).collect(),
            unhealthy: unhealthy.into_iter().map(|(n, _)| n).collect(),
        }
    }
}

// ---- the Tauri command tying it together ----

pub(crate) async fn connect_session(
    app: &tauri::AppHandle,
    profile: &Profile,
) -> Result<SshSession, SshError> {
    let home = app.path().home_dir().ok();
    let target = crate::ssh::commands::target_from_profile(profile, home)?;
    let verifier = KnownHostsVerifier::for_app(app)?;
    SshSession::connect(&target, verifier).await
}

/// Probe the remote machine (over one short-lived exec session) and the
/// forwarded ports, and say whether to attach, bring up, or bail with a
/// specific error card. Call only after the tunnel reports every essential
/// forward bound — see the module docs.
#[tauri::command]
pub async fn classify_remote_stack(
    app: tauri::AppHandle,
    profile: Profile,
) -> Result<StackClassification, SshError> {
    let session = connect_session(&app, &profile).await?;
    let path = repo_path(&profile);

    let local = health::poll_once(&health::client(), &health::Endpoints::local_default()).await;
    let run_py_exists = session
        .exec_capture(&probe_run_py_command(&path))
        .await?
        .success();
    let python = parse_python_probe(&session.exec_capture(python_version_command()).await?);

    let services = if run_py_exists && python.meets_minimum() && !local.ready {
        let out = session.exec_capture(&status_command(&path)).await?;
        if out.success() {
            parse_status_services(&out.stdout)
        } else {
            None
        }
    } else {
        None
    };
    session.close().await;

    // The probe just validated (or refuted) the repo path; on success, write
    // the resolved value back so the profile stops relying on the default.
    if run_py_exists {
        let _ = crate::profiles::persist_repo_path(&app, &profile.id, &path);
    }

    Ok(classify(
        local.ready,
        run_py_exists,
        &python,
        services.as_deref(),
        &path,
    ))
}

// ---- remote bring-up: `run.py --json-events` streamed over ssh exec ----

/// Raw NDJSON lines from the remote bring-up, one event payload per line —
/// the same event name the native launcher path uses, so the frontend's
/// parser/reducer (`lib/events.ts`) is shared unchanged.
pub const BRINGUP_LINE_EVENT: &str = "bringup-line";
/// Fired once when the remote bring-up command finishes (or dies).
pub const BRINGUP_EXIT_EVENT: &str = "bringup-exit";
/// Where the remote command's stderr (human display output) is kept.
pub const BRINGUP_STDERR_LOG: &str = "remote-bringup.log";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct BringUpExit {
    /// Remote exit code; `None` when the channel closed without one (killed
    /// session, network drop) — pair with `error` for the reason if known.
    pub exit_code: Option<u32>,
    /// Why it failed, when the remote said so on stderr. Without this the UI
    /// only has the exit code to go on, and code 2 is ambiguous: it is the
    /// `--json-events` contract for "needed interactive input" *and* what
    /// Typer returns for a usage error, so a bad flag was being reported to
    /// the user as a prompt they had to answer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The last few stderr lines, for the exit event. Bounded because stderr can
/// be a whole TUI render; the tail is where the reason is.
fn stderr_tail(raw: &[u8]) -> Option<String> {
    const MAX_LINES: usize = 6;
    const MAX_CHARS: usize = 600;
    let text = String::from_utf8_lossy(raw);
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        // Drop the box-drawing scaffolding of a rich/Typer error panel; the
        // message inside it is what matters.
        .map(|l| l.trim_matches(|c: char| "│╭╰─╮╯ ".contains(c)))
        .filter(|l| !l.is_empty())
        .collect();
    let tail = lines
        .iter()
        .rev()
        .take(MAX_LINES)
        .rev()
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    let tail = tail.trim().to_string();
    if tail.is_empty() {
        return None;
    }
    Some(match tail.char_indices().nth(MAX_CHARS) {
        Some((idx, _)) => format!("{}…", &tail[..idx]),
        None => tail,
    })
}

/// At most one remote bring-up runs at a time. Holds the session so
/// cancellation can close it, which ends the exec stream.
#[derive(Default)]
pub struct RemoteState {
    bring_up: tokio::sync::Mutex<Option<BringUpHandle>>,
}

struct BringUpHandle {
    session: std::sync::Arc<SshSession>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl RemoteState {
    /// Tear down any in-flight bring-up without emitting an exit event.
    pub(crate) async fn cancel(&self) {
        if let Some(handle) = self.bring_up.lock().await.take() {
            handle.task.abort();
            handle.session.close().await;
        }
    }
}

/// Start `python3 run.py --no-browser --json-events` on the remote machine
/// and stream its stdout to the launcher as `bringup-line` events; stderr
/// (the human-facing display output) goes to `remote-bringup.log` in the app
/// log dir. Replaces any bring-up already running.
#[tauri::command]
pub async fn start_remote_bring_up(
    app: tauri::AppHandle,
    state: tauri::State<'_, RemoteState>,
    profile: Profile,
    accept_terms: Option<bool>,
) -> Result<(), SshError> {
    let session = std::sync::Arc::new(connect_session(&app, &profile).await?);
    let command = bring_up_command(&repo_path(&profile), accept_terms.unwrap_or(false));
    let mut stderr_log = stderr_log_file(&app);
    // Tee the NDJSON stream to disk for the logs viewer, next to the stderr log.
    let ndjson_log = app
        .path()
        .app_log_dir()
        .ok()
        .map(|dir| crate::logs::LineLog::create(&dir.join("remote-bringup.ndjson")));

    let task_session = session.clone();
    let task = tauri::async_runtime::spawn(async move {
        use std::io::Write;
        use tauri::Emitter;
        const STDERR_KEEP: usize = 8 * 1024;
        let mut stderr_seen: Vec<u8> = Vec::new();
        let line_app = app.clone();
        let result = task_session
            .exec_stream(
                &command,
                |line| {
                    if let Some(log) = &ndjson_log {
                        log.append(line);
                    }
                    let _ = line_app.emit(BRINGUP_LINE_EVENT, line);
                },
                |chunk| {
                    if let Some(f) = &mut stderr_log {
                        let _ = f.write_all(chunk);
                    }
                    // Keep a bounded copy so a failure can say why, not just
                    // what exit code it had.
                    if stderr_seen.len() < STDERR_KEEP {
                        stderr_seen.extend_from_slice(chunk);
                        stderr_seen.truncate(STDERR_KEEP);
                    }
                },
            )
            .await;
        task_session.close().await;
        let exit = match result {
            Ok(exit_code) => BringUpExit {
                exit_code,
                // Only on failure: a successful run's stderr is just the
                // launcher's own display output.
                error: match exit_code {
                    Some(0) => None,
                    _ => stderr_tail(&stderr_seen),
                },
            },
            Err(e) => BringUpExit {
                exit_code: None,
                error: Some(e.to_string()),
            },
        };
        let _ = app.emit(BRINGUP_EXIT_EVENT, &exit);
    });

    let mut guard = state.bring_up.lock().await;
    if let Some(previous) = guard.take() {
        previous.task.abort();
        previous.session.close().await;
    }
    *guard = Some(BringUpHandle { session, task });
    Ok(())
}

/// Stop a running remote bring-up by closing its SSH session (ends the exec
/// channel; sshd tears the remote process group down with it). Idempotent.
#[tauri::command]
pub async fn cancel_remote_bring_up(state: tauri::State<'_, RemoteState>) -> Result<(), SshError> {
    state.cancel().await;
    Ok(())
}

/// Fresh log file per bring-up; failures to create it degrade to discarding
/// stderr rather than blocking the bring-up.
fn stderr_log_file(app: &tauri::AppHandle) -> Option<std::fs::File> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::File::create(dir.join(BRINGUP_STDERR_LOG)).ok()
}

// ---- quitting: optionally stop the remote stack on the way out ----

/// Output lines from `run.py --stop` while the quit dialog streams it.
pub const REMOTE_STOP_EVENT: &str = "remote-stop-line";

/// The profile the current SSH connection belongs to, for the quit dialog's
/// "Stop the stack on <host>" wording. `None` on local connections.
#[tauri::command]
pub fn get_active_remote(
    tunnels: tauri::State<'_, crate::ssh::commands::TunnelState>,
) -> Option<Profile> {
    tunnels.active_profile()
}

/// Leave the app. With `stop_stack`, first run `run.py --stop` on the active
/// remote machine, streaming its output as `remote-stop-line` events; a stop
/// that fails returns the error WITHOUT quitting so the user can decide to
/// quit anyway. Without it (or with no active remote), just disconnect.
#[tauri::command]
pub async fn quit_app(
    app: tauri::AppHandle,
    tunnels: tauri::State<'_, crate::ssh::commands::TunnelState>,
    remote: tauri::State<'_, RemoteState>,
    stop_stack: bool,
) -> Result<(), SshError> {
    // A quit aborts any in-flight bring-up either way.
    remote.cancel().await;
    if stop_stack {
        if let Some(profile) = tunnels.active_profile() {
            use tauri::Emitter;
            let session = connect_session(&app, &profile).await?;
            let command = stop_command(&repo_path(&profile));
            let line_app = app.clone();
            let exit = session
                .exec_stream(
                    &command,
                    |line| {
                        let _ = line_app.emit(REMOTE_STOP_EVENT, line);
                    },
                    |_| {},
                )
                .await;
            session.close().await;
            match exit {
                Ok(Some(0)) => {}
                Ok(code) => {
                    return Err(SshError::Internal {
                        message: match code {
                            Some(code) => format!("run.py --stop exited with code {code}"),
                            None => "run.py --stop ended without an exit code".to_string(),
                        },
                    })
                }
                Err(e) => return Err(e),
            }
        }
    }
    tunnels.shutdown().await;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(exit_code: Option<u32>, stdout: &str) -> ExecOutput {
        ExecOutput {
            exit_code,
            stdout: stdout.to_string(),
            stderr: String::new(),
        }
    }

    fn py(major: u32, minor: u32) -> PythonProbe {
        PythonProbe::Found {
            major,
            minor,
            raw: format!("Python {major}.{minor}.0"),
        }
    }

    #[test]
    fn python_probe_parses_versions_and_failures() {
        assert_eq!(
            parse_python_probe(&out(Some(0), "Python 3.12.3\n")),
            PythonProbe::Found {
                major: 3,
                minor: 12,
                raw: "Python 3.12.3".into()
            }
        );
        assert!(matches!(
            parse_python_probe(&out(Some(127), "sh: python3: not found\n")),
            PythonProbe::Missing { .. }
        ));
        assert!(matches!(
            parse_python_probe(&out(Some(0), "garbage")),
            PythonProbe::Missing { .. }
        ));
    }

    #[test]
    fn python_minimum_is_3_12() {
        assert!(py(3, 12).meets_minimum());
        assert!(py(3, 13).meets_minimum());
        assert!(py(4, 0).meets_minimum());
        assert!(!py(3, 11).meets_minimum());
        assert!(!py(2, 7).meets_minimum());
    }

    #[test]
    fn status_services_parse_from_the_ndjson_dump() {
        let stdout = concat!(
            "not json at all\n",
            r#"{"v":1,"ts":1.0,"event":"note","phase":null,"detail":{"text":"x"}}"#,
            "\n",
            r#"{"v":1,"ts":2.0,"event":"status","phase":null,"detail":{"services":[{"name":"frontend","port":3000,"url":"http://localhost:3000","healthy":true},{"name":"backend","port":8000,"healthy":false}],"head":"abc1234","hardware":"P300"}}"#,
            "\n",
        );
        assert_eq!(
            parse_status_services(stdout).unwrap(),
            vec![
                ("frontend".to_string(), true),
                ("backend".to_string(), false)
            ]
        );
        assert_eq!(parse_status_services("plain text\n"), None);
    }

    #[test]
    fn healthy_tunnelled_stack_always_attaches() {
        // Even with a hostile-looking remote (no checkout, no python): if
        // every service answers through the tunnel, attach.
        let missing = PythonProbe::Missing {
            message: "nope".into(),
        };
        assert_eq!(
            classify(true, false, &missing, None, "~/tt-studio"),
            StackClassification::Healthy
        );
    }

    #[test]
    fn missing_run_py_is_an_invalid_path_error() {
        let c = classify(false, false, &py(3, 12), None, "~/elsewhere");
        assert_eq!(
            c,
            StackClassification::NoCheckout {
                path: "~/elsewhere".into()
            }
        );
        assert!(!c.needs_bring_up());
    }

    #[test]
    fn old_or_missing_python_blocks_bring_up() {
        assert_eq!(
            classify(false, true, &py(3, 11), None, "~/tt-studio"),
            StackClassification::PythonTooOld {
                found: "Python 3.11.0".into(),
                required: "3.12".into()
            }
        );
        let missing = PythonProbe::Missing {
            message: "python3 not found".into(),
        };
        assert!(matches!(
            classify(false, true, &missing, None, "~/tt-studio"),
            StackClassification::PythonMissing { .. }
        ));
    }

    #[test]
    fn service_mix_distinguishes_partial_from_down() {
        let services = vec![
            ("frontend".to_string(), true),
            ("backend".to_string(), false),
        ];
        let c = classify(false, true, &py(3, 12), Some(&services), "~/tt-studio");
        assert_eq!(
            c,
            StackClassification::Partial {
                healthy: vec!["frontend".into()],
                unhealthy: vec!["backend".into()],
            }
        );
        assert!(c.needs_bring_up());

        let all_down = vec![("frontend".to_string(), false)];
        assert_eq!(
            classify(false, true, &py(3, 12), Some(&all_down), "~/tt-studio"),
            StackClassification::Down
        );
        // No status output at all (old checkout without the flag) → Down.
        assert_eq!(
            classify(false, true, &py(3, 12), None, "~/tt-studio"),
            StackClassification::Down
        );
    }

    #[test]
    fn classification_serializes_with_kind_discriminant() {
        let json = serde_json::to_value(StackClassification::NoCheckout {
            path: "~/tt-studio".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "no_checkout");
        assert_eq!(json["path"], "~/tt-studio");
        let json = serde_json::to_value(StackClassification::Healthy).unwrap();
        assert_eq!(json["kind"], "healthy");
    }

    #[test]
    fn remote_commands_quote_the_repo_path() {
        assert_eq!(
            probe_run_py_command("~/tt-studio"),
            "test -f \"$HOME\"/'tt-studio'/run.py"
        );
        assert_eq!(
            status_command("/opt/tt studio"),
            "cd '/opt/tt studio' && python3 run.py --status --json"
        );
        assert_eq!(
            bring_up_command("~/tt-studio", false),
            "cd \"$HOME\"/'tt-studio' && python3 run.py --no-browser --json-events"
        );
        assert_eq!(
            stop_command("~/tt-studio"),
            "cd \"$HOME\"/'tt-studio' && python3 run.py --stop 2>&1"
        );
    }

    #[test]
    fn bring_up_exit_serializes_for_the_ui() {
        let json = serde_json::to_value(BringUpExit {
            exit_code: Some(2),
            error: None,
        })
        .unwrap();
        assert_eq!(json["exit_code"], 2);
        assert!(json.get("error").is_none());

        let json = serde_json::to_value(BringUpExit {
            exit_code: None,
            error: Some("connection lost".into()),
        })
        .unwrap();
        assert!(json["exit_code"].is_null());
        assert_eq!(json["error"], "connection lost");
    }

    #[test]
    fn repo_path_falls_back_to_default() {
        let mut profile = Profile {
            id: "p".into(),
            name: "n".into(),
            kind: crate::profiles::ProfileKind::Ssh,
            host: Some("h".into()),
            port: None,
            user: Some("u".into()),
            auth: None,
            remote_repo_path: None,
            last_used: None,
        };
        assert_eq!(repo_path(&profile), DEFAULT_REPO_PATH);
        profile.remote_repo_path = Some("  ".into());
        assert_eq!(repo_path(&profile), DEFAULT_REPO_PATH);
        profile.remote_repo_path = Some("/opt/tt-studio".into());
        assert_eq!(repo_path(&profile), "/opt/tt-studio");
    }

    #[test]
    fn accept_terms_is_opt_in_and_never_the_default() {
        let plain = bring_up_command("~/tt-studio", false);
        assert!(!plain.contains("--accept-terms"), "{plain}");
        let accepted = bring_up_command("~/tt-studio", true);
        assert!(
            accepted.ends_with("--json-events --accept-terms"),
            "{accepted}"
        );
    }

    #[test]
    fn stderr_tail_pulls_the_reason_out_of_a_typer_error_panel() {
        // Verbatim shape of what a bad flag produces on the remote.
        let raw = b"Usage: run.py [OPTIONS] COMMAND [ARGS]...\n\
Try 'run.py -h' for help.\n\
\xe2\x95\xad\xe2\x94\x80 Error \xe2\x94\x80\xe2\x95\xae\n\
\xe2\x94\x82 No such option: --json-events   \xe2\x94\x82\n\
\xe2\x95\xb0\xe2\x94\x80\xe2\x95\xaf\n";
        let tail = stderr_tail(raw).expect("a reason");
        assert!(
            tail.contains("No such option: --json-events"),
            "got {tail:?}"
        );
        assert!(!tail.contains('\u{2502}'), "box drawing should be stripped");
    }

    #[test]
    fn stderr_tail_says_nothing_when_there_is_nothing_to_say() {
        assert_eq!(stderr_tail(b""), None);
        assert_eq!(stderr_tail(b"   \n\n  \n"), None);
    }

    #[test]
    fn stderr_tail_keeps_only_the_end_and_caps_length() {
        let many: String = (0..50).map(|i| format!("line {i}\n")).collect();
        let tail = stderr_tail(many.as_bytes()).unwrap();
        assert!(tail.contains("line 49"), "the end is the interesting part");
        assert!(!tail.contains("line 10"));
        let huge = "x".repeat(5000);
        assert!(stderr_tail(huge.as_bytes()).unwrap().len() <= 700);
    }

    #[test]
    fn a_failed_exit_carries_its_reason_to_the_ui() {
        let exit = BringUpExit {
            exit_code: Some(2),
            error: Some("No such option: --json-events".into()),
        };
        let json = serde_json::to_value(&exit).unwrap();
        assert_eq!(json["exit_code"], 2);
        assert_eq!(json["error"], "No such option: --json-events");
        // A clean exit stays quiet.
        let ok = serde_json::to_value(BringUpExit {
            exit_code: Some(0),
            error: None,
        })
        .unwrap();
        assert!(ok.get("error").is_none());
    }
}
