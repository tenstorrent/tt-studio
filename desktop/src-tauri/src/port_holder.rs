// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Who is holding a local port.
//!
//! Purely decorative: when a tunnel listener can't bind, this names the
//! process squatting on the port so the error card can say "held by ssh
//! (pid 95452)" instead of guessing at a stray dev server. Every failure
//! path degrades to `None` — a missing `lsof` must never turn a port
//! conflict into a worse error.

use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PortHolder {
    pub pid: u32,
    /// Process name as the OS reports it ("ssh", "node", "Docker").
    pub name: String,
}

/// Best-effort lookup of the process listening on `port` on this machine.
/// Blocking (spawns a probe binary) — call it off the async path.
pub fn listener_on(port: u16) -> Option<PortHolder> {
    #[cfg(windows)]
    return windows_listener(port);
    #[cfg(not(windows))]
    return unix_listener(port);
}

#[cfg(not(windows))]
fn unix_listener(port: u16) -> Option<PortHolder> {
    // `+c 0` defeats lsof's 9-character COMMAND truncation; `-F pcn` prints
    // one field per line (p=pid, c=command) instead of a padded table.
    let out = Command::new("lsof")
        .args([
            "-nP",
            "+c",
            "0",
            "-sTCP:LISTEN",
            "-F",
            "pc",
            &format!("-iTCP:{port}"),
        ])
        .output()
        .ok()?;
    parse_lsof(&String::from_utf8_lossy(&out.stdout))
}

/// First pid/command pair in lsof's `-F` output. Several rows are normal
/// (one per bound address family); they're the same process.
fn parse_lsof(stdout: &str) -> Option<PortHolder> {
    let mut pid = None;
    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.trim().parse::<u32>().ok();
        } else if let Some(value) = line.strip_prefix('c') {
            let name = value.trim();
            if let (Some(pid), false) = (pid, name.is_empty()) {
                return Some(PortHolder {
                    pid,
                    name: name.to_string(),
                });
            }
        }
    }
    None
}

#[cfg(windows)]
fn windows_listener(port: u16) -> Option<PortHolder> {
    let out = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
        .ok()?;
    let pid = parse_netstat(&String::from_utf8_lossy(&out.stdout), port)?;
    let name = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output()
        .ok()
        .and_then(|o| parse_tasklist(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_else(|| format!("pid {pid}"));
    Some(PortHolder { pid, name })
}

/// PID of the first TCP row LISTENING on `port` in `netstat -ano` output.
#[cfg(windows)]
fn parse_netstat(stdout: &str, port: u16) -> Option<u32> {
    let suffix = format!(":{port}");
    stdout.lines().find_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        match cols.as_slice() {
            [_, local, _, state, pid] if *state == "LISTENING" && local.ends_with(&suffix) => {
                pid.parse().ok()
            }
            _ => None,
        }
    })
}

/// Image name from the first CSV row of `tasklist /NH /FO CSV`.
#[cfg(windows)]
fn parse_tasklist(stdout: &str) -> Option<String> {
    let first = stdout.lines().find(|l| !l.trim().is_empty())?;
    let name = first.split(',').next()?.trim().trim_matches('"');
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_holder_out_of_lsof_fields() {
        let out = "p95452\nssh\ncssh\nn[::1]:3000\nn127.0.0.1:3000\n";
        assert_eq!(
            parse_lsof(out),
            Some(PortHolder {
                pid: 95452,
                name: "ssh".into()
            })
        );
    }

    #[test]
    fn parses_a_command_name_containing_spaces() {
        let out = "p417\ncGoogle Chrome Helper\nn127.0.0.1:3000\n";
        assert_eq!(parse_lsof(out).unwrap().name, "Google Chrome Helper");
    }

    #[test]
    fn no_holder_when_lsof_found_nothing() {
        assert_eq!(parse_lsof(""), None);
        assert_eq!(parse_lsof("\n"), None);
    }

    #[test]
    fn free_port_has_no_holder() {
        // Bind and drop, so the port is almost certainly unused.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        assert_eq!(listener_on(port), None);
    }

    #[test]
    fn finds_this_test_process_holding_a_port() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // lsof may be absent (minimal containers); only assert when it ran.
        if let Some(holder) = listener_on(port) {
            assert_eq!(holder.pid, std::process::id());
        }
    }

    #[cfg(windows)]
    #[test]
    fn parses_netstat_and_tasklist() {
        let netstat = "  Proto  Local Address  Foreign Address  State\n\
                         TCP    127.0.0.1:3000  0.0.0.0:0  LISTENING  95452\n";
        assert_eq!(parse_netstat(netstat, 3000), Some(95452));
        assert_eq!(parse_netstat(netstat, 3001), None);
        assert_eq!(
            parse_tasklist("\"ssh.exe\",\"95452\",\"Console\",\"1\",\"9,000 K\"\n").as_deref(),
            Some("ssh.exe")
        );
    }
}
