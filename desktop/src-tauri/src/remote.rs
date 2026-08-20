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

pub fn bring_up_command(path: &str) -> String {
    format!(
        "cd {} && python3 run.py --no-browser --json-events",
        quote_path(path)
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

async fn connect_session(
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

    Ok(classify(
        local.ready,
        run_py_exists,
        &python,
        services.as_deref(),
        &path,
    ))
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
            bring_up_command("~/tt-studio"),
            "cd \"$HOME\"/'tt-studio' && python3 run.py --no-browser --json-events"
        );
        assert_eq!(
            stop_command("~/tt-studio"),
            "cd \"$HOME\"/'tt-studio' && python3 run.py --stop 2>&1"
        );
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
}
