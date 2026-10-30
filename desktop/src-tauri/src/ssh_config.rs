// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Machines the user has already configured in `~/.ssh/config`.
//!
//! The profile editor asks for a name, host, port, user, key path and repo
//! path — all of which usually already exist in the user's SSH config. This
//! module reads them so the picker can offer those machines directly.
//!
//! Two halves, because OpenSSH gives you exactly one of the two things
//! needed and never both:
//!
//! 1. **Enumerate.** `ssh` has no "list my hosts" mode, and `ssh -G <alias>`
//!    happily succeeds for an alias that does not exist (echoing defaults
//!    with `hostname == alias`), so it cannot be used to discover names. We
//!    parse `Host` lines ourselves, following `Include`.
//! 2. **Resolve.** Hand each alias to `ssh -G`, which applies the real
//!    matching rules — `Match` blocks, wildcards, later-wins precedence,
//!    included files — and prints the effective settings. Re-implementing
//!    that would be a bug farm.
//!
//! Nothing here opens a network connection: `ssh -G` is invoked with
//! `CanonicalizeHostname=no`, the one resolve-time setting that can trigger
//! DNS. The app only reaches a machine when the user clicks it.
//!
//! Caveat worth knowing: a `Match exec "<cmd>"` block makes `ssh -G` run
//! that command, so scanning is not strictly side-effect free. It is the
//! user's own config and plain `ssh` behaves identically, but it is why the
//! scan is capped and runs off the main thread.
//!
//! Detected hosts are deliberately **not** persisted. `profiles.json` only
//! gains a row when the user connects to one (`adopt_detected_host`) — a
//! config with forty aliases would otherwise fill the picker with rows to
//! delete, and profile ids are also OS-keychain keys (`secrets.rs`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Wry;

use crate::profiles::{Profile, ProfileKind, SshAuth};

/// OpenSSH's own `Include` depth limit.
const MAX_INCLUDE_DEPTH: usize = 16;
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// More than this and the picker stops being a list and becomes a haystack.
const MAX_ALIASES: usize = 200;

// ---- pure parsing (unit-tested, no IO) ----

/// One config line split into keyword and remaining tokens. `None` for
/// blanks and comments. Keyword/value may be separated by whitespace or `=`,
/// and values may be quoted.
fn split_line(line: &str) -> Option<(String, Vec<String>)> {
    let line = line.split('#').next().unwrap_or("").trim();
    if line.is_empty() {
        return None;
    }
    let (keyword, rest) = match line.find(['=', ' ', '\t']) {
        Some(idx) => (
            &line[..idx],
            line[idx + 1..].trim_start_matches(['=', ' ', '\t']),
        ),
        None => (line, ""),
    };
    if keyword.is_empty() {
        return None;
    }
    Some((keyword.to_ascii_lowercase(), tokenize(rest)))
}

/// Whitespace-separated tokens, honoring double quotes.
fn tokenize(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for ch in value.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// A pattern we can offer as a one-click machine: a literal name. Wildcards
/// (`Host *`) and negations (`!bastion`) are matching rules, not machines.
fn is_selectable_alias(pattern: &str) -> bool {
    !pattern.is_empty()
        && !pattern.starts_with('!')
        && !pattern.contains('*')
        && !pattern.contains('?')
}

#[derive(Debug, Default, PartialEq)]
struct ParsedFile {
    aliases: Vec<String>,
    includes: Vec<String>,
}

/// Aliases and includes in one config file, in file order. `Match` blocks are
/// skipped: they never introduce a name, and `ssh -G` applies their effect
/// at resolve time, which is the whole point of the split.
fn parse_config_text(text: &str) -> ParsedFile {
    let mut parsed = ParsedFile::default();
    for line in text.lines() {
        let Some((keyword, tokens)) = split_line(line) else {
            continue;
        };
        match keyword.as_str() {
            // Not `hostname`, `hostkeyalgorithms`, `hostbasedauthentication`.
            "host" => parsed
                .aliases
                .extend(tokens.into_iter().filter(|t| is_selectable_alias(t))),
            "include" => parsed.includes.extend(tokens),
            _ => {}
        }
    }
    parsed
}

/// `*` and `?` against one path component. OpenSSH documents no `**` for
/// Include, and a real pattern is `config.d/*` or `*.conf`.
fn matches_glob(pattern: &str, name: &str) -> bool {
    fn walk(p: &[u8], n: &[u8]) -> bool {
        match p.first() {
            None => n.is_empty(),
            Some(b'*') => walk(&p[1..], n) || (!n.is_empty() && walk(p, &n[1..])),
            Some(b'?') => !n.is_empty() && walk(&p[1..], &n[1..]),
            Some(c) => n.first() == Some(c) && walk(&p[1..], &n[1..]),
        }
    }
    walk(pattern.as_bytes(), name.as_bytes())
}

/// Resolve an `Include` argument. `~` is the user's home; a relative path is
/// relative to the including file's directory (`~/.ssh` for the user config).
fn resolve_include(raw: &str, base_dir: &Path, home: &Path) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = Path::new(raw);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base_dir.join(path)
    }
}

// ---- walking the config tree ----

#[derive(Debug, Default, PartialEq)]
pub struct AliasScan {
    pub aliases: Vec<String>,
    /// Hit [`MAX_ALIASES`]; the UI says the list is partial.
    pub truncated: bool,
}

/// Every selectable alias reachable from `root`, first-seen order.
pub fn collect_aliases(root: &Path, home: &Path) -> AliasScan {
    let mut scan = AliasScan::default();
    let mut seen_alias = HashSet::new();
    let mut visited: HashSet<PathBuf> = HashSet::new();
    let mut queue = vec![(root.to_path_buf(), 0usize)];

    while let Some((path, depth)) = queue.first().cloned() {
        queue.remove(0);
        if depth > MAX_INCLUDE_DEPTH || visited.len() >= MAX_FILES {
            continue;
        }
        // Canonicalize so an include cycle is a cycle even via symlinks.
        let key = path.canonicalize().unwrap_or_else(|_| path.clone());
        if !visited.insert(key) {
            continue;
        }
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_FILE_BYTES) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue; // missing or unreadable is not an error here
        };
        let parsed = parse_config_text(&text);
        for alias in parsed.aliases {
            if scan.aliases.len() >= MAX_ALIASES {
                scan.truncated = true;
                break;
            }
            if seen_alias.insert(alias.to_ascii_lowercase()) {
                scan.aliases.push(alias);
            }
        }
        let base_dir = path.parent().unwrap_or(home).to_path_buf();
        for include in parsed.includes {
            let resolved = resolve_include(&include, &base_dir, home);
            queue.extend(expand_include(&resolved, depth + 1));
        }
    }
    scan
}

/// One resolved include, expanded if its last component is a glob.
fn expand_include(path: &Path, depth: usize) -> Vec<(PathBuf, usize)> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !name.contains('*') && !name.contains('?') {
        return vec![(path.to_path_buf(), depth)];
    }
    let Some(dir) = path.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut matched: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| matches_glob(name, n))
        })
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    matched.sort(); // read_dir order is arbitrary; keep scans reproducible
    matched.into_iter().map(|p| (p, depth)).collect()
}

// ---- resolving one alias through `ssh -G` ----

/// Effective settings for one alias.
#[derive(Debug, Default, PartialEq)]
pub struct ResolvedConfig {
    pub hostname: String,
    pub user: String,
    pub port: u16,
    /// In `-G` order, tildes intact (the form `SshAuth::Key` stores).
    pub identity_files: Vec<String>,
    /// `ProxyJump`/`ProxyCommand` target, when the alias needs one.
    pub proxy: Option<String>,
    /// Local ports the alias forwards itself — what makes an `ssh` process
    /// holding one of our ports identifiable (see port_clear.rs).
    pub local_forwards: Vec<u16>,
}

/// Parse `ssh -G` stdout: lowercase `keyword value` lines, one per setting.
pub fn parse_ssh_g(stdout: &str) -> ResolvedConfig {
    let mut config = ResolvedConfig {
        port: 22,
        ..Default::default()
    };
    let mut proxy_jump = None;
    let mut proxy_command = None;
    for line in stdout.lines() {
        let Some((keyword, tokens)) = split_line(line) else {
            continue;
        };
        let first = tokens.first().map(String::as_str).unwrap_or("");
        match keyword.as_str() {
            "hostname" => config.hostname = first.to_string(),
            "user" => config.user = first.to_string(),
            "port" => {
                if let Ok(port) = first.parse() {
                    config.port = port;
                }
            }
            "identityfile" => config.identity_files.push(first.to_string()),
            // Some versions omit these when unset, others print "none".
            "proxyjump" if !first.eq_ignore_ascii_case("none") => {
                proxy_jump = Some(first.to_string())
            }
            "proxycommand" if !first.eq_ignore_ascii_case("none") => {
                proxy_command = Some(tokens.join(" "))
            }
            // `localforward <local> <remote-host>:<remote-port>`
            "localforward" => {
                if let Ok(port) = first.parse() {
                    config.local_forwards.push(port);
                }
            }
            _ => {}
        }
    }
    config.proxy = proxy_jump.or(proxy_command).filter(|p| !p.is_empty());
    config
}

/// How an alias gets resolved. Injected so tests never read the developer's
/// real `~/.ssh/config`.
pub trait ConfigResolver {
    /// `ssh -G` stdout for `alias`, or None when it could not be run.
    fn resolve(&self, alias: &str) -> Option<String>;
}

/// Resolves by running the system `ssh`.
pub struct SshBinaryResolver {
    /// `-F <path>` when set (tests only); the user's default config if None.
    pub config_path: Option<PathBuf>,
}

impl ConfigResolver for SshBinaryResolver {
    fn resolve(&self, alias: &str) -> Option<String> {
        let mut command = Command::new("ssh");
        command.arg("-G");
        // Resolution must not touch the network: canonicalization is the one
        // -G-time setting that resolves names. A command-line -o wins over
        // whatever the config says.
        command.args(["-o", "CanonicalizeHostname=no"]);
        command.args(["-o", "BatchMode=yes"]);
        if let Some(path) = &self.config_path {
            command.arg("-F").arg(path);
        }
        command.arg("--").arg(alias);
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        // stdout only: -G writes advisories like the pseudo-terminal note to
        // stderr.
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

// ---- what the UI gets ----

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum UnsupportedReason {
    /// Reached through another host. The dialer connects directly only, so
    /// this is said up front rather than discovered as a DNS failure.
    Proxy { via: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DetectedHost {
    /// The alias as written — what the user recognizes and types.
    pub alias: String,
    /// Effective HostName: the name actually dialed.
    pub hostname: String,
    pub port: u16,
    pub user: String,
    /// Chosen IdentityFile, unexpanded. None means agent-only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    /// Local ports this alias forwards itself.
    #[serde(default)]
    pub local_forwards: Vec<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<UnsupportedReason>,
    /// The saved profile this alias already is, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub existing_profile_id: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct SshHostDetection {
    pub hosts: Vec<DetectedHost>,
    pub truncated: bool,
    /// No config file, or no `ssh` binary. The UI shows no section at all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<String>,
}

/// OpenSSH prints its whole built-in identity list when the config names no
/// key, and replaces that list entirely when it does. So a single entry that
/// exists on disk is a real choice; zero or several is the default set.
///
/// Guessing wrong is cheap either way: `target_from_profile` always tries the
/// agent first and only then the key file.
pub fn pick_identity(files: &[String], home: &Path) -> Option<String> {
    let [only] = files else {
        return None;
    };
    let expanded = match only.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(only),
    };
    expanded.is_file().then(|| only.clone())
}

/// The saved profile that already represents this host, if any. Matches on
/// the dialed hostname *or* the alias, since a hand-typed profile may hold
/// either.
pub fn match_existing(detected: &DetectedHost, profiles: &[Profile]) -> Option<String> {
    profiles
        .iter()
        .find(|p| {
            if p.kind != ProfileKind::Ssh {
                return false;
            }
            if p.port.unwrap_or(22) != detected.port {
                return false;
            }
            let host_matches = p.host.as_deref().is_some_and(|h| {
                h.eq_ignore_ascii_case(&detected.hostname)
                    || h.eq_ignore_ascii_case(&detected.alias)
            });
            let user_matches = match p.user.as_deref().map(str::trim) {
                None | Some("") => true,
                Some(user) => user.eq_ignore_ascii_case(&detected.user),
            };
            host_matches && user_matches
        })
        .map(|p| p.id.clone())
}

/// Turn a scan plus a resolver into the list the picker renders. Pure given
/// the resolver, so the whole feature is testable without subprocesses.
pub fn detect_from(
    scan: &AliasScan,
    resolver: &dyn ConfigResolver,
    profiles: &[Profile],
    home: &Path,
) -> SshHostDetection {
    let mut hosts: Vec<DetectedHost> = Vec::new();
    let mut seen_target = HashSet::new();

    for alias in &scan.aliases {
        let Some(stdout) = resolver.resolve(alias) else {
            continue;
        };
        let resolved = parse_ssh_g(&stdout);
        if resolved.hostname.is_empty() || resolved.user.is_empty() {
            continue;
        }
        // Two aliases for one machine (`Host qb2 quietbox`) are one row.
        let target = (
            resolved.user.to_ascii_lowercase(),
            resolved.hostname.to_ascii_lowercase(),
            resolved.port,
        );
        if !seen_target.insert(target) {
            continue;
        }
        let mut host = DetectedHost {
            alias: alias.clone(),
            hostname: resolved.hostname,
            port: resolved.port,
            user: resolved.user,
            identity_file: pick_identity(&resolved.identity_files, home),
            local_forwards: resolved.local_forwards,
            unsupported: resolved.proxy.map(|via| UnsupportedReason::Proxy { via }),
            existing_profile_id: None,
        };
        host.existing_profile_id = match_existing(&host, profiles);
        hosts.push(host);
    }

    SshHostDetection {
        hosts,
        truncated: scan.truncated,
        unavailable: None,
    }
}

/// Alias → profile. The alias becomes the display name (it is what the user
/// recognizes) and the resolved hostname becomes `host` — never the reverse:
/// `target_from_profile` feeds `host` straight to the resolver.
pub fn profile_from_detected(host: &DetectedHost) -> Profile {
    Profile {
        id: detected_profile_id(&host.alias),
        name: host.alias.clone(),
        kind: ProfileKind::Ssh,
        host: Some(host.hostname.clone()),
        port: Some(host.port),
        user: Some(host.user.clone()),
        auth: Some(match &host.identity_file {
            Some(path) => SshAuth::Key { path: path.clone() },
            None => SshAuth::Agent,
        }),
        remote_repo_path: None,
        last_used: None,
    }
}

/// Deterministic, so adopting the same alias twice updates one row instead
/// of adding another — and so its keychain entry survives re-adoption.
fn detected_profile_id(alias: &str) -> String {
    let slug: String = alias
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    format!("ssh-config:{slug}")
}

// ---- commands ----

fn home_dir() -> Option<PathBuf> {
    #[allow(deprecated)]
    std::env::home_dir()
}

/// Scan `~/.ssh/config` and report the machines it describes. No network.
#[tauri::command]
pub async fn detect_ssh_hosts(app: tauri::AppHandle<Wry>) -> Result<SshHostDetection, String> {
    let profiles = crate::profiles::list_profiles(app).unwrap_or_default();
    // File IO plus one subprocess per alias: never on the UI's thread.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(home) = home_dir() else {
            return SshHostDetection {
                unavailable: Some("no home directory".into()),
                ..Default::default()
            };
        };
        let root = home.join(".ssh").join("config");
        if !root.is_file() {
            return SshHostDetection {
                unavailable: Some("no ~/.ssh/config".into()),
                ..Default::default()
            };
        }
        let scan = collect_aliases(&root, &home);
        if scan.aliases.is_empty() {
            return SshHostDetection::default();
        }
        let resolver = SshBinaryResolver { config_path: None };
        // One probe tells us whether `ssh` exists at all, so a machine
        // without it reports "unavailable" instead of an empty list.
        if resolver.resolve(&scan.aliases[0]).is_none() {
            return SshHostDetection {
                unavailable: Some("ssh is not available".into()),
                ..Default::default()
            };
        }
        detect_from(&scan, &resolver, &profiles, &home)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Aliases whose own `LocalForward` lines cover any of `ports`.
///
/// This is what makes an `ssh` process holding one of the stack's ports
/// identifiable: the forward usually comes from the config file, so argv
/// carries the alias but no `-L` (see port_clear.rs). Best-effort — an empty
/// result just means the port-clear step recognizes fewer holders.
pub fn forwarding_aliases(ports: &[u16]) -> Vec<String> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    let root = home.join(".ssh").join("config");
    if !root.is_file() {
        return Vec::new();
    }
    let scan = collect_aliases(&root, &home);
    let resolver = SshBinaryResolver { config_path: None };
    scan.aliases
        .into_iter()
        .filter(|alias| {
            resolver
                .resolve(alias)
                .map(|stdout| parse_ssh_g(&stdout))
                .is_some_and(|config| config.local_forwards.iter().any(|p| ports.contains(p)))
        })
        .collect()
}

/// Save a detected host as a real profile so it can be connected to.
#[tauri::command]
pub fn adopt_detected_host(
    app: tauri::AppHandle<Wry>,
    host: DetectedHost,
) -> Result<Profile, String> {
    if host.unsupported.is_some() {
        return Err("this machine is reached through a jump host".into());
    }
    let profile = profile_from_detected(&host);
    crate::profiles::save_profile(app, profile.clone())?;
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> ParsedFile {
        parse_config_text(text)
    }

    #[test]
    fn reads_host_lines_in_every_spelling() {
        let scan = parsed(
            "Host alpha\n\
             host  beta  gamma\n\
             Host=delta\n\
             Host \"epsilon\"\n\
             Host zeta # trailing comment\n\
             # Host commented-out\n\
             \tHost indented\n",
        );
        assert_eq!(
            scan.aliases,
            ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "indented"]
        );
    }

    #[test]
    fn never_mistakes_a_host_prefixed_keyword_for_a_host_line() {
        // The near-misses that would silently poison the list.
        let scan = parsed(
            "Host real\n\
               HostName box.example.com\n\
               HostKeyAlgorithms +ssh-rsa\n\
               HostbasedAuthentication no\n",
        );
        assert_eq!(scan.aliases, ["real"]);
    }

    #[test]
    fn skips_patterns_that_are_rules_rather_than_machines() {
        for pattern in ["*", "foo*", "!bastion", "10.0.?.?", ""] {
            assert!(!is_selectable_alias(pattern), "{pattern} is not a machine");
        }
        for pattern in ["qb2", "qbge-devex-01", "a.b.c"] {
            assert!(is_selectable_alias(pattern), "{pattern} is a machine");
        }
        let scan = parsed("Host * \nHost real\nHost !nope other\n");
        assert_eq!(scan.aliases, ["real", "other"]);
    }

    #[test]
    fn match_blocks_contribute_no_aliases() {
        let scan = parsed("Match host foo exec \"true\"\n  User bar\nHost real\n");
        assert_eq!(scan.aliases, ["real"]);
    }

    #[test]
    fn survives_crlf_line_endings() {
        let scan = parsed("Host alpha\r\n  HostName a\r\nHost beta\r\n");
        assert_eq!(scan.aliases, ["alpha", "beta"]);
    }

    #[test]
    fn collects_include_paths() {
        let scan = parsed("Include ~/.ssh/conf.d/*\nInclude \"a b.conf\" other.conf\n");
        assert_eq!(scan.includes, ["~/.ssh/conf.d/*", "a b.conf", "other.conf"]);
    }

    #[test]
    fn globs_match_one_component() {
        assert!(matches_glob("*", "anything"));
        assert!(matches_glob("*.conf", "work.conf"));
        assert!(matches_glob("conf?", "confA"));
        assert!(matches_glob("exact", "exact"));
        assert!(!matches_glob("*.conf", "work.cfg"));
        assert!(!matches_glob("conf?", "conf"));
        assert!(!matches_glob("exact", "exactly"));
    }

    #[test]
    fn include_paths_resolve_against_home_or_the_including_file() {
        let home = Path::new("/home/u");
        let base = Path::new("/home/u/.ssh");
        assert_eq!(
            resolve_include("~/.ssh/extra", base, home),
            PathBuf::from("/home/u/.ssh/extra")
        );
        assert_eq!(
            resolve_include("/etc/ssh/global", base, home),
            PathBuf::from("/etc/ssh/global")
        );
        assert_eq!(
            resolve_include("conf.d/work", base, home),
            PathBuf::from("/home/u/.ssh/conf.d/work")
        );
    }

    // ---- the scan, against real files ----

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn follows_a_glob_include() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        write(&home.join(".ssh/config"), "Host base\nInclude conf.d/*\n");
        write(&home.join(".ssh/conf.d/a.conf"), "Host from-a\n");
        write(&home.join(".ssh/conf.d/b.conf"), "Host from-b\n");
        let scan = collect_aliases(&home.join(".ssh/config"), home);
        assert_eq!(scan.aliases, ["base", "from-a", "from-b"]);
        assert!(!scan.truncated);
    }

    #[test]
    fn an_include_cycle_terminates() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        write(&home.join(".ssh/config"), "Host one\nInclude b\n");
        write(&home.join(".ssh/b"), "Host two\nInclude config\n");
        let scan = collect_aliases(&home.join(".ssh/config"), home);
        assert_eq!(scan.aliases, ["one", "two"]);
    }

    #[test]
    fn a_missing_config_is_an_empty_scan_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let scan = collect_aliases(&dir.path().join("nope"), dir.path());
        assert_eq!(scan, AliasScan::default());
    }

    #[test]
    fn duplicate_aliases_appear_once() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        write(
            &home.join(".ssh/config"),
            "Host dup\nHost DUP\nHost other\n",
        );
        let scan = collect_aliases(&home.join(".ssh/config"), home);
        assert_eq!(scan.aliases, ["dup", "other"]);
    }

    #[test]
    fn a_huge_config_is_truncated_rather_than_rendered() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let body: String = (0..MAX_ALIASES + 50)
            .map(|i| format!("Host box-{i}\n"))
            .collect();
        write(&home.join(".ssh/config"), &body);
        let scan = collect_aliases(&home.join(".ssh/config"), home);
        assert_eq!(scan.aliases.len(), MAX_ALIASES);
        assert!(scan.truncated);
    }

    #[test]
    fn an_oversized_file_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let mut body = String::from("Host huge\n");
        body.push_str(&"# padding padding padding\n".repeat(60_000));
        write(&home.join(".ssh/config"), &body);
        assert!(body.len() as u64 > MAX_FILE_BYTES);
        assert!(collect_aliases(&home.join(".ssh/config"), home)
            .aliases
            .is_empty());
    }

    // ---- ssh -G ----

    /// Verbatim from `ssh -G qbge-devex-01` on macOS, OpenSSH 10.2p1.
    const REAL_SSH_G: &str = "user jashan
hostname qbge-devex-01.aus1.tenstorrent.com
port 22
addressfamily any
identityfile ~/.ssh/id_ed25519
localforward 3000 [localhost]:3000
localforward 8000 [localhost]:8000
hostkeyalgorithms ssh-ed25519-cert-v01@openssh.com,ecdsa-sha2-nistp256-cert-v01@openssh.com
serveraliveinterval 60
forwardagent yes
";

    #[test]
    fn parses_a_real_ssh_g_dump() {
        let config = parse_ssh_g(REAL_SSH_G);
        assert_eq!(config.hostname, "qbge-devex-01.aus1.tenstorrent.com");
        assert_eq!(config.user, "jashan");
        assert_eq!(config.port, 22);
        assert_eq!(config.identity_files, ["~/.ssh/id_ed25519"]);
        assert_eq!(config.local_forwards, [3000, 8000]);
        assert_eq!(config.proxy, None);
    }

    #[test]
    fn reads_a_proxy_from_either_directive() {
        assert_eq!(
            parse_ssh_g("hostname h\nuser u\nproxyjump bastion\n").proxy,
            Some("bastion".into())
        );
        assert_eq!(
            parse_ssh_g("hostname h\nuser u\nproxycommand nc -X 5 %h %p\n").proxy,
            Some("nc -X 5 %h %p".into())
        );
        // Both spellings of "unset" that OpenSSH versions use.
        assert_eq!(parse_ssh_g("hostname h\nproxycommand none\n").proxy, None);
        assert_eq!(parse_ssh_g("hostname h\n").proxy, None);
    }

    #[test]
    fn a_nonstandard_port_is_carried_through() {
        assert_eq!(parse_ssh_g("hostname h\nuser u\nport 2222\n").port, 2222);
        // Garbage keeps the default rather than dropping the host.
        assert_eq!(parse_ssh_g("hostname h\nport wat\n").port, 22);
    }

    #[test]
    fn identity_is_only_taken_when_the_config_names_exactly_one() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::write(home.join(".ssh/id_ed25519"), "key").unwrap();

        assert_eq!(
            pick_identity(&["~/.ssh/id_ed25519".into()], home),
            Some("~/.ssh/id_ed25519".into())
        );
        // A named key that isn't there: fall back to the agent.
        assert_eq!(pick_identity(&["~/.ssh/absent".into()], home), None);
        // OpenSSH's built-in default list means "the config named none".
        let defaults: Vec<String> = ["~/.ssh/id_rsa", "~/.ssh/id_ecdsa", "~/.ssh/id_ed25519"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_identity(&defaults, home), None);
        assert_eq!(pick_identity(&[], home), None);
    }

    // ---- detection end to end, with no subprocesses ----

    struct FakeResolver(std::collections::HashMap<String, String>);

    impl ConfigResolver for FakeResolver {
        fn resolve(&self, alias: &str) -> Option<String> {
            self.0.get(alias).cloned()
        }
    }

    fn fake(pairs: &[(&str, &str)]) -> FakeResolver {
        FakeResolver(
            pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    fn scan_of(aliases: &[&str]) -> AliasScan {
        AliasScan {
            aliases: aliases.iter().map(|s| s.to_string()).collect(),
            truncated: false,
        }
    }

    #[test]
    fn detects_hosts_in_config_order() {
        let home = tempfile::tempdir().unwrap();
        let scan = scan_of(&["one", "two"]);
        let resolver = fake(&[
            ("one", "hostname a.example\nuser jashan\nport 22\n"),
            ("two", "hostname b.example\nuser jashan\nport 2222\n"),
        ]);
        let detection = detect_from(&scan, &resolver, &[], home.path());
        assert_eq!(detection.hosts.len(), 2);
        assert_eq!(detection.hosts[0].alias, "one");
        assert_eq!(detection.hosts[0].hostname, "a.example");
        assert_eq!(detection.hosts[1].port, 2222);
        assert!(detection.hosts.iter().all(|h| h.unsupported.is_none()));
    }

    #[test]
    fn two_aliases_for_one_machine_collapse_to_the_first() {
        let home = tempfile::tempdir().unwrap();
        let same = "hostname box.example\nuser jashan\nport 22\n";
        let detection = detect_from(
            &scan_of(&["qb2", "quietbox"]),
            &fake(&[("qb2", same), ("quietbox", same)]),
            &[],
            home.path(),
        );
        assert_eq!(detection.hosts.len(), 1);
        assert_eq!(detection.hosts[0].alias, "qb2");
    }

    #[test]
    fn a_jump_host_is_marked_unsupported_rather_than_offered() {
        let home = tempfile::tempdir().unwrap();
        let detection = detect_from(
            &scan_of(&["behind"]),
            &fake(&[(
                "behind",
                "hostname internal.example\nuser jashan\nproxyjump bastion.example\n",
            )]),
            &[],
            home.path(),
        );
        assert_eq!(
            detection.hosts[0].unsupported,
            Some(UnsupportedReason::Proxy {
                via: "bastion.example".into()
            })
        );
    }

    #[test]
    fn hosts_that_cannot_be_resolved_are_dropped() {
        let home = tempfile::tempdir().unwrap();
        let detection = detect_from(
            &scan_of(&["good", "unresolvable", "hostless"]),
            &fake(&[
                ("good", "hostname a.example\nuser u\n"),
                ("hostless", "user u\n"),
            ]),
            &[],
            home.path(),
        );
        assert_eq!(detection.hosts.len(), 1);
        assert_eq!(detection.hosts[0].alias, "good");
    }

    fn saved(id: &str, host: &str, user: Option<&str>, port: Option<u16>) -> Profile {
        Profile {
            id: id.into(),
            name: "Saved".into(),
            kind: ProfileKind::Ssh,
            host: Some(host.into()),
            port,
            user: user.map(str::to_string),
            auth: None,
            remote_repo_path: None,
            last_used: None,
        }
    }

    fn detected(alias: &str, hostname: &str, user: &str, port: u16) -> DetectedHost {
        DetectedHost {
            alias: alias.into(),
            hostname: hostname.into(),
            port,
            user: user.into(),
            identity_file: None,
            local_forwards: Vec::new(),
            unsupported: None,
            existing_profile_id: None,
        }
    }

    #[test]
    fn recognizes_a_machine_the_user_already_saved() {
        let host = detected("qb2", "box.example", "jashan", 22);
        // By resolved hostname…
        assert_eq!(
            match_existing(
                &host,
                &[saved("p1", "box.example", Some("jashan"), Some(22))]
            ),
            Some("p1".into())
        );
        // …by the alias they typed instead…
        assert_eq!(
            match_existing(&host, &[saved("p2", "qb2", Some("jashan"), None)]),
            Some("p2".into())
        );
        // …and a profile with no user still counts as the same machine.
        assert_eq!(
            match_existing(&host, &[saved("p3", "box.example", None, Some(22))]),
            Some("p3".into())
        );
    }

    #[test]
    fn a_different_user_or_port_is_a_different_machine() {
        let host = detected("qb2", "box.example", "jashan", 22);
        assert_eq!(
            match_existing(&host, &[saved("p1", "box.example", Some("root"), Some(22))]),
            None
        );
        assert_eq!(
            match_existing(
                &host,
                &[saved("p1", "box.example", Some("jashan"), Some(2222))]
            ),
            None
        );
        assert_eq!(match_existing(&host, &[]), None);
    }

    #[test]
    fn detection_flags_hosts_that_are_already_profiles() {
        let home = tempfile::tempdir().unwrap();
        let detection = detect_from(
            &scan_of(&["qb2"]),
            &fake(&[("qb2", "hostname box.example\nuser jashan\nport 22\n")]),
            &[saved("p1", "box.example", Some("jashan"), Some(22))],
            home.path(),
        );
        assert_eq!(
            detection.hosts[0].existing_profile_id.as_deref(),
            Some("p1")
        );
    }

    #[test]
    fn adopting_an_alias_keeps_the_name_and_dials_the_hostname() {
        let mut host = detected("qb2", "box.example", "jashan", 2222);
        host.identity_file = Some("~/.ssh/id_ed25519".into());
        let profile = profile_from_detected(&host);
        assert_eq!(profile.name, "qb2", "the alias is what the user recognizes");
        assert_eq!(profile.host.as_deref(), Some("box.example"));
        assert_eq!(profile.port, Some(2222));
        assert_eq!(profile.user.as_deref(), Some("jashan"));
        assert_eq!(
            profile.auth,
            Some(SshAuth::Key {
                path: "~/.ssh/id_ed25519".into()
            })
        );
        assert_eq!(profile.kind, ProfileKind::Ssh);

        // No key named: the agent, which is tried first regardless.
        let plain = profile_from_detected(&detected("qb2", "box.example", "jashan", 22));
        assert_eq!(plain.auth, Some(SshAuth::Agent));
    }

    #[test]
    fn adopting_the_same_alias_twice_is_the_same_profile() {
        let host = detected("qb2", "box.example", "jashan", 22);
        assert_eq!(
            profile_from_detected(&host).id,
            profile_from_detected(&host).id
        );
        assert_eq!(detected_profile_id("qb2"), "ssh-config:qb2");
        // Anything that could confuse a store key is flattened.
        assert_eq!(detected_profile_id("a b/c"), "ssh-config:a_b_c");
    }

    #[test]
    fn a_detected_host_round_trips_through_json() {
        let mut host = detected("qb2", "box.example", "jashan", 22);
        host.local_forwards = vec![3000, 8000];
        host.unsupported = Some(UnsupportedReason::Proxy { via: "b".into() });
        let json = serde_json::to_value(&host).unwrap();
        assert_eq!(json["unsupported"]["code"], "proxy");
        assert_eq!(json["local_forwards"][0], 3000);
        assert_eq!(serde_json::from_value::<DetectedHost>(json).unwrap(), host);
    }

    /// The one test that exercises the real `ssh -G`, against a config we
    /// wrote ourselves — `-F` guarantees the developer's own is never read.
    #[test]
    fn the_real_ssh_binary_resolves_a_temp_config() {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config");
        std::fs::write(
            &config,
            "Host fixture\n  HostName fixture.example\n  User fixtureuser\n  Port 2022\n",
        )
        .unwrap();
        let resolver = SshBinaryResolver {
            config_path: Some(config),
        };
        let Some(stdout) = resolver.resolve("fixture") else {
            eprintln!("skipping: no usable `ssh` on PATH");
            return;
        };
        let parsed = parse_ssh_g(&stdout);
        assert_eq!(parsed.hostname, "fixture.example");
        assert_eq!(parsed.user, "fixtureuser");
        assert_eq!(parsed.port, 2022);
    }
}
