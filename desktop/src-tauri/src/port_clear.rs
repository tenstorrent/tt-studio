// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Clearing the stack's local ports before opening a tunnel.
//!
//! The tunnel has to bind the real port numbers — the web app derives its
//! service URLs from `window.location` plus fixed ports, so remapping is not
//! an option (see `ssh/tunnel.rs`). That makes a squatter on 3000 fatal to a
//! connect, and the common squatter is not a stray dev server: it is an
//! editor's Remote-SSH session inheriting `LocalForward 3000` from the user's
//! own `~/.ssh/config`.
//!
//! So this module frees a port when — and only when — it can positively
//! identify what holds it. The rule is an **allowlist**: an ssh client
//! forwarding the port, or a leftover copy of this app. Everything else,
//! including Docker, is reported and left alone. Any "kill everything except
//! X" formulation eventually kills someone's work.
//!
//! Notably, matching `-L` in the command line is not enough. The real holder
//! on a developer's machine looks like
//! `ssh -T -D 62534 qbge-devex-02 bash --login -c bash` — the forwards come
//! from the config file, so argv contains no `-L` at all. What identifies it
//! is that argv names an alias whose own config forwards this port, which is
//! why `ssh_config.rs` collects `local_forwards`.

use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::port_holder::{listener_on, PortHolder};

/// How long to wait for a port to actually come free after a SIGTERM.
const FREE_TIMEOUT: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Everything known about a pid before deciding whether to signal it.
#[derive(Clone, Debug, PartialEq)]
pub struct ProcessFacts {
    pub pid: u32,
    /// Basename of argv[0]: "ssh", "docker-proxy", "tt-studio-desktop".
    pub name: String,
    /// The full command line, as `ps -o command=` reports it.
    pub command: String,
    /// The pid runs as us. We never signal another user's process.
    pub own_user: bool,
}

/// What a port's holder is, as far as we can prove.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HolderClass {
    /// An ssh client forwarding this port. Killing it ends that session.
    SshForward {
        /// The alias it is connected to, when argv names one.
        #[serde(skip_serializing_if = "Option::is_none")]
        alias: Option<String>,
    },
    /// A leftover instance of this very app.
    StaleSelf,
    /// A Docker published port. Recognized, but never killed: the listener is
    /// a proxy process, not the container — killing it takes down unrelated
    /// containers and Docker often just restarts it. `run.py --stop` is the
    /// correct lever.
    Docker,
    /// Anything else. Reported, never touched.
    Unknown,
}

impl HolderClass {
    /// Whether we may free this holder without asking.
    pub fn auto_clearable(&self) -> bool {
        matches!(self, Self::SshForward { .. } | Self::StaleSelf)
    }
}

// ---- classification (pure, the tested heart of this module) ----

/// Docker's listener processes, none of which is the container itself.
fn is_docker_process(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "docker-proxy"
        || lower == "docker"
        || lower.starts_with("com.docker")
        || lower.starts_with("vpnkit")
        || lower.starts_with("containerd")
}

/// Whether argv asks for a local forward of `port` (`-L 3000:...`,
/// `-L127.0.0.1:3000:...`, or `-L 3000 ...`).
fn forwards_port_via_argv(command: &str, port: u16) -> bool {
    let tokens: Vec<&str> = command.split_whitespace().collect();
    tokens.iter().enumerate().any(|(i, token)| {
        let spec = match token.strip_prefix("-L") {
            // `-L<spec>` glued together, or `-L <spec>` as the next token.
            Some("") => tokens.get(i + 1).copied().unwrap_or(""),
            Some(rest) => rest,
            None => return false,
        };
        // The local port is the field before the remote host:port. With a
        // bind address it is the second field, otherwise the first.
        let fields: Vec<&str> = spec.split(':').collect();
        match fields.as_slice() {
            [local, ..] if local.parse::<u16>() == Ok(port) => true,
            [_bind, local, ..] if local.parse::<u16>() == Ok(port) => true,
            _ => false,
        }
    })
}

/// The ssh-config alias named in argv, if any of `aliases` appears there.
fn alias_in_argv(command: &str, aliases: &[String]) -> Option<String> {
    command
        .split_whitespace()
        .find(|token| aliases.iter().any(|alias| alias == token))
        .map(str::to_string)
}

/// Classify a port's holder. `forwarding_aliases` are the ssh-config aliases
/// whose own `LocalForward` lines cover this port (from `ssh_config.rs`).
pub fn classify(
    facts: &ProcessFacts,
    port: u16,
    self_pid: u32,
    self_exe_name: &str,
    forwarding_aliases: &[String],
) -> HolderClass {
    // Guard rails first: never another user's process, never init, never us.
    if !facts.own_user || facts.pid <= 1 || facts.pid == self_pid {
        return HolderClass::Unknown;
    }
    if !self_exe_name.is_empty() && facts.name == self_exe_name {
        return HolderClass::StaleSelf;
    }
    if is_docker_process(&facts.name) {
        return HolderClass::Docker;
    }
    // Exactly `ssh` — not sshd (a server), not ssh-agent (holds no ports).
    if facts.name == "ssh" {
        if let Some(alias) = alias_in_argv(&facts.command, forwarding_aliases) {
            return HolderClass::SshForward { alias: Some(alias) };
        }
        if forwards_port_via_argv(&facts.command, port) {
            return HolderClass::SshForward { alias: None };
        }
    }
    HolderClass::Unknown
}

// ---- gathering facts about a pid ----

/// `ps -o uid=,command=` output: the leading uid, then the command line.
fn parse_ps_row(stdout: &str) -> Option<(u32, String)> {
    let line = stdout.lines().find(|l| !l.trim().is_empty())?;
    let trimmed = line.trim_start();
    let split = trimmed.find(char::is_whitespace)?;
    let uid = trimmed[..split].parse().ok()?;
    let command = trimmed[split..].trim().to_string();
    (!command.is_empty()).then_some((uid, command))
}

#[cfg(not(windows))]
fn ps_row(pid: u32) -> Option<(u32, String)> {
    let output = Command::new("ps")
        .args(["-o", "uid=,command=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| parse_ps_row(&String::from_utf8_lossy(&output.stdout)))
        .flatten()
}

/// Our own uid, learned through the same probe so there is no libc dependency
/// and no chance of the two disagreeing.
#[cfg(not(windows))]
fn own_uid() -> Option<u32> {
    static UID: OnceLock<Option<u32>> = OnceLock::new();
    *UID.get_or_init(|| ps_row(std::process::id()).map(|(uid, _)| uid))
}

#[cfg(not(windows))]
pub fn facts_for(pid: u32) -> Option<ProcessFacts> {
    let (uid, command) = ps_row(pid)?;
    let name = command
        .split_whitespace()
        .next()
        .map(|argv0| {
            Path::new(argv0)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(argv0)
                .to_string()
        })
        .unwrap_or_default();
    Some(ProcessFacts {
        pid,
        own_user: own_uid() == Some(uid),
        name,
        command,
    })
}

/// Windows has no cheap command-line probe (`wmic` is gone, CIM is slow), so
/// every holder classifies Unknown and the user gets the same prompt they got
/// before this module existed — degraded, not regressed.
#[cfg(windows)]
pub fn facts_for(_pid: u32) -> Option<ProcessFacts> {
    None
}

/// The name our own executable reports in `ps`, for the StaleSelf check.
fn self_exe_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default()
}

// ---- freeing a port ----

/// Whether `port` can be bound right now. Binding is the only honest proof:
/// `lsof` lags, and a socket can be held by a descriptor elsewhere.
fn port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// SIGTERM `pid`, then wait for `port` to actually come free.
///
/// Deliberately no SIGKILL escalation: an ssh client that ignores SIGTERM is
/// doing something we do not understand, and SIGKILL on an editor's remote
/// session can lose unsaved work. A port still held after the timeout falls
/// through to the prompt, where forcing it is the user's call.
pub fn terminate_and_wait(pid: u32, port: u16, timeout: Duration) -> bool {
    if pid <= 1 {
        return false;
    }
    let sent = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .status()
        .is_ok_and(|s| s.success());
    if !sent {
        return false;
    }
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if port_is_free(port) {
            return true;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    port_is_free(port)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct FreedPort {
    pub port: u16,
    pub holder: PortHolder,
    pub class: HolderClass,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SkippedPort {
    pub port: u16,
    /// None when something holds the port but the probe could not say what.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holder: Option<PortHolder>,
    pub class: HolderClass,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct ClearReport {
    pub freed: Vec<FreedPort>,
    pub skipped: Vec<SkippedPort>,
}

impl ClearReport {
    /// Nothing held any port: the ordinary case, and nothing to report.
    pub fn is_quiet(&self) -> bool {
        self.freed.is_empty() && self.skipped.is_empty()
    }
}

/// Probe each port and free the ones held by something we recognize.
///
/// Never touches a port nobody holds, and reports every port it could not
/// clear so the caller can explain rather than fail silently.
pub fn clear_ports(ports: &[u16], forwarding_aliases: &[String]) -> ClearReport {
    let mut report = ClearReport::default();
    let self_pid = std::process::id();
    let exe = self_exe_name();

    for &port in ports {
        let Some(holder) = listener_on(port) else {
            continue; // free, or nothing we can see — the tunnel will tell us
        };
        let Some(facts) = facts_for(holder.pid) else {
            report.skipped.push(SkippedPort {
                port,
                holder: Some(holder),
                class: HolderClass::Unknown,
            });
            continue;
        };
        let class = classify(&facts, port, self_pid, &exe, forwarding_aliases);
        if !class.auto_clearable() {
            report.skipped.push(SkippedPort {
                port,
                holder: Some(holder),
                class,
            });
            continue;
        }
        // Re-assert the invariants immediately before signalling: this is the
        // one irreversible step in the module.
        if !facts.own_user || facts.pid <= 1 || facts.pid == self_pid {
            report.skipped.push(SkippedPort {
                port,
                holder: Some(holder),
                class: HolderClass::Unknown,
            });
            continue;
        }
        if terminate_and_wait(facts.pid, port, FREE_TIMEOUT) {
            report.freed.push(FreedPort {
                port,
                holder,
                class,
            });
        } else {
            report.skipped.push(SkippedPort {
                port,
                holder: Some(holder),
                class,
            });
        }
    }
    report
}

// ---- command ----

/// Ports the stack cannot run without. Derived from the tunnel's own map so
/// the two can never drift; the marketplace app range is excluded because a
/// taken app port only affects that one app.
fn essential_ports() -> Vec<u16> {
    const ESSENTIAL: [u16; 6] = [3000, 8000, 8001, 8002, 4000, 8080];
    crate::ssh::tunnel::production_forwards()
        .into_iter()
        .map(|spec| spec.local_port)
        .filter(|port| ESSENTIAL.contains(port))
        .collect()
}

/// Free the stack's local ports where it is safe to, before the tunnel tries
/// to bind them. Running this *before* `start_ssh_tunnels` means we never
/// build an SSH session only to tear it down, and "one attempt per connect"
/// is true by construction — there is a single call site and no retry loop.
#[tauri::command]
pub async fn prepare_local_ports(app: tauri::AppHandle<tauri::Wry>) -> Result<ClearReport, String> {
    let ports = essential_ports();
    // Which ssh-config aliases forward these ports — the signal that makes an
    // `ssh` holder identifiable.
    let aliases = crate::ssh_config::forwarding_aliases(&ports);
    tauri::async_runtime::spawn_blocking(move || clear_ports(&ports, &aliases))
        .await
        .inspect(|report| log_report(&app, report))
        .map_err(|e| e.to_string())
}

/// Write what we freed to the app log. A kill that appears in no log is
/// indefensible — and `bug_report.rs` bundles these logs, so a user who later
/// says "my editor keeps disconnecting" has the evidence.
fn log_report(app: &tauri::AppHandle<tauri::Wry>, report: &ClearReport) {
    if report.freed.is_empty() {
        return;
    }
    for freed in &report.freed {
        let line = format!(
            "freed port {} held by {} (pid {}) — classified {:?}",
            freed.port, freed.holder.name, freed.holder.pid, freed.class
        );
        crate::logs::append_app_line(app, &line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(name: &str, command: &str) -> ProcessFacts {
        ProcessFacts {
            pid: 4242,
            name: name.into(),
            command: command.into(),
            own_user: true,
        }
    }

    const SELF_EXE: &str = "tt-studio-desktop";
    const SELF_PID: u32 = 999;

    fn class(facts: &ProcessFacts, port: u16, aliases: &[&str]) -> HolderClass {
        let aliases: Vec<String> = aliases.iter().map(|s| s.to_string()).collect();
        classify(facts, port, SELF_PID, SELF_EXE, &aliases)
    }

    #[test]
    fn parses_a_real_ps_row() {
        // Exactly what `ps -o uid=,command=` prints for the motivating case.
        let row = "  501 ssh -T -D 62534 -o ControlPath=/tmp/x qbge-devex-02 bash --login";
        let (uid, command) = parse_ps_row(row).unwrap();
        assert_eq!(uid, 501);
        assert!(command.starts_with("ssh -T -D 62534"));
        assert!(command.ends_with("bash --login"));
    }

    #[test]
    fn ps_rows_that_say_nothing_useful_are_rejected() {
        assert_eq!(parse_ps_row(""), None);
        assert_eq!(parse_ps_row("\n\n"), None);
        assert_eq!(parse_ps_row("  501 "), None, "no command");
        assert_eq!(parse_ps_row("notanumber ssh"), None);
    }

    #[test]
    fn an_ssh_session_to_a_forwarding_alias_is_clearable() {
        // The motivating case: no -L anywhere in argv, because the forward
        // comes from ~/.ssh/config. The alias in argv is what gives it away.
        let editor_session = facts("ssh", "ssh -T -D 62534 qbge-devex-02 bash --login -c bash");
        assert_eq!(
            class(&editor_session, 3000, &["qbge-devex-01", "qbge-devex-02"]),
            HolderClass::SshForward {
                alias: Some("qbge-devex-02".into())
            }
        );
        assert!(class(&editor_session, 3000, &["qbge-devex-02"]).auto_clearable());
    }

    #[test]
    fn an_explicit_dash_l_is_clearable_without_any_alias() {
        for command in [
            "ssh -L 3000:localhost:3000 box",
            "ssh -L3000:localhost:3000 box",
            "ssh -L 127.0.0.1:3000:localhost:3000 box",
        ] {
            assert_eq!(
                class(&facts("ssh", command), 3000, &[]),
                HolderClass::SshForward { alias: None },
                "{command}"
            );
        }
        // A forward of a different port does not explain *this* port.
        assert_eq!(
            class(&facts("ssh", "ssh -L 9999:localhost:9999 box"), 3000, &[]),
            HolderClass::Unknown
        );
    }

    #[test]
    fn an_ssh_process_we_cannot_explain_is_left_alone() {
        // No alias we know, no -L for this port: not our business.
        assert_eq!(
            class(&facts("ssh", "ssh someone-elses-box"), 3000, &["qb2"]),
            HolderClass::Unknown
        );
    }

    #[test]
    fn the_near_misses_are_never_clearable() {
        // sshd is a server; ssh-agent holds no ports. Matching either would
        // be a very bad day for the user.
        for name in ["sshd", "ssh-agent", "sshfs", "mosh"] {
            assert_eq!(
                class(
                    &facts(name, &format!("{name} -L 3000:localhost:3000 box")),
                    3000,
                    &["qb2"]
                ),
                HolderClass::Unknown,
                "{name}"
            );
        }
    }

    #[test]
    fn a_dev_server_is_reported_not_killed() {
        // Somebody is using this. Ask, never assume.
        for (name, command) in [
            ("node", "node /usr/local/bin/vite --port 3000"),
            ("python3", "python3 -m http.server 3000"),
            ("Google Chrome Helper", "/Applications/Chrome --port 3000"),
        ] {
            let holder = facts(name, command);
            assert_eq!(class(&holder, 3000, &[]), HolderClass::Unknown, "{name}");
            assert!(!class(&holder, 3000, &[]).auto_clearable());
        }
    }

    #[test]
    fn docker_is_recognized_but_never_cleared() {
        for name in ["docker-proxy", "com.docker.backend", "vpnkit", "containerd"] {
            let holder = facts(name, &format!("/usr/bin/{name} -host-port 3000"));
            assert_eq!(class(&holder, 3000, &[]), HolderClass::Docker, "{name}");
            assert!(
                !class(&holder, 3000, &[]).auto_clearable(),
                "{name} must never be killed — the container is the real owner"
            );
        }
    }

    #[test]
    fn a_leftover_copy_of_this_app_is_clearable() {
        let stale = facts(SELF_EXE, "/Applications/TT-Studio.app/... --flag");
        assert_eq!(class(&stale, 3000, &[]), HolderClass::StaleSelf);
        assert!(class(&stale, 3000, &[]).auto_clearable());

        // …but never the process making the decision.
        let me = ProcessFacts {
            pid: SELF_PID,
            ..facts(SELF_EXE, "/Applications/TT-Studio.app/...")
        };
        assert_eq!(class(&me, 3000, &[]), HolderClass::Unknown);
    }

    #[test]
    fn another_users_process_and_init_are_untouchable() {
        let other_user = ProcessFacts {
            own_user: false,
            ..facts("ssh", "ssh -L 3000:localhost:3000 qb2")
        };
        assert_eq!(class(&other_user, 3000, &["qb2"]), HolderClass::Unknown);

        let init = ProcessFacts {
            pid: 1,
            ..facts("ssh", "ssh -L 3000:localhost:3000 qb2")
        };
        assert_eq!(class(&init, 3000, &["qb2"]), HolderClass::Unknown);
    }

    #[test]
    fn the_port_list_never_drifts_from_the_tunnels() {
        let ports = essential_ports();
        for expected in [3000u16, 8000, 8001, 8002, 4000, 8080] {
            assert!(ports.contains(&expected), "missing {expected}");
        }
        // 8111 (ChromaDB) is forwarded but not fatal to a connect, so the
        // clear step must not go killing things for it.
        assert!(!ports.contains(&8111));
    }

    #[test]
    fn a_report_serializes_for_the_ui() {
        let report = ClearReport {
            freed: vec![FreedPort {
                port: 3000,
                holder: PortHolder {
                    pid: 1250,
                    name: "ssh".into(),
                },
                class: HolderClass::SshForward {
                    alias: Some("qb2".into()),
                },
            }],
            skipped: vec![SkippedPort {
                port: 8000,
                holder: Some(PortHolder {
                    pid: 77,
                    name: "docker-proxy".into(),
                }),
                class: HolderClass::Docker,
            }],
        };
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["freed"][0]["class"]["kind"], "ssh_forward");
        assert_eq!(json["freed"][0]["class"]["alias"], "qb2");
        assert_eq!(json["freed"][0]["holder"]["pid"], 1250);
        assert_eq!(json["skipped"][0]["class"]["kind"], "docker");
        assert!(!report.is_quiet());
        assert!(ClearReport::default().is_quiet());
    }

    #[test]
    fn clearing_ports_nobody_holds_does_nothing() {
        // Bind-and-drop: almost certainly free, and definitely not ours.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        assert_eq!(clear_ports(&[port], &[]), ClearReport::default());
    }

    #[test]
    fn facts_describe_this_very_process() {
        let Some(facts) = facts_for(std::process::id()) else {
            eprintln!("skipping: no usable `ps` on this platform");
            return;
        };
        assert!(facts.own_user, "our own pid must classify as our user");
        assert!(!facts.name.is_empty());
        assert!(!facts.command.is_empty());
    }
}
