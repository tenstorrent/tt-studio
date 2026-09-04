// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Bug-report bundles from the desktop shell.
//!
//! Reuses the launcher's own machinery (`python run.py --report-bug`,
//! tt_setup/bug_report.py): it collects host-side logs and system info into
//! `logs/tt-studio-logs-ttbr-<hex>.zip` inside the checkout. `--no-browser`
//! keeps it from opening a GitHub issue tab — the desktop app reveals the
//! ZIP in the file manager instead and the user attaches it wherever they
//! report.
//!
//! Local profiles spawn the command in the local checkout; SSH profiles run
//! it in the remote checkout, then copy the ZIP back over the same session
//! (`base64` over an exec channel — no sftp subsystem required) into the
//! app's data dir.

use serde::Serialize;
use tauri::{Manager, Wry};

use crate::profiles::Profile;
use crate::ssh::exec::quote_path;
use crate::ssh::SshTransport;

/// Progress lines (the launcher's human output) while a bundle is collected.
pub const BUGREPORT_LINE_EVENT: &str = "bugreport-line";

/// Bundle filenames as written by tt_setup/bug_report.py.
pub const BUNDLE_PREFIX: &str = "tt-studio-logs-ttbr-";

// ---- the exact commands ----

/// Local spawn spec: `run.py --report-bug --no-browser` inside the checkout.
pub fn report_bug_spec(
    checkout: &std::path::Path,
    stderr_log: std::path::PathBuf,
) -> crate::launcher::SpawnSpec {
    crate::launcher::SpawnSpec {
        program: "python3".to_string(),
        args: ["run.py", "--report-bug", "--no-browser"]
            .map(String::from)
            .to_vec(),
        cwd: checkout.to_path_buf(),
        stderr_log,
        envs: Vec::new(),
    }
}

/// The same over ssh exec. `2>&1` so the human progress output arrives on
/// the streamed channel.
pub fn report_bug_command(path: &str) -> String {
    format!(
        "cd {} && python3 run.py --report-bug --no-browser 2>&1",
        quote_path(path)
    )
}

/// Newest bundle in the remote checkout's logs dir (empty stdout when none).
pub fn newest_bundle_command(path: &str) -> String {
    format!(
        "ls -t {}/logs/{BUNDLE_PREFIX}*.zip 2>/dev/null | head -1",
        quote_path(path)
    )
}

/// Stream the bundle back as base64 (ASCII survives the lossy UTF-8 capture).
pub fn fetch_bundle_command(remote_zip: &str) -> String {
    format!("base64 < {}", quote_path(remote_zip))
}

// ---- pure helpers ----

pub fn is_bundle_name(name: &str) -> bool {
    name.starts_with(BUNDLE_PREFIX) && name.ends_with(".zip")
}

/// The `ttbr-<hex>` reference inside a bundle filename, for display.
pub fn bundle_ref(name: &str) -> Option<&str> {
    if !is_bundle_name(name) {
        return None;
    }
    name.strip_prefix("tt-studio-logs-")?.strip_suffix(".zip")
}

/// Newest `tt-studio-logs-ttbr-*.zip` under `<checkout>/logs`.
pub fn newest_bundle_in(checkout: &std::path::Path) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(checkout.join("logs")).ok()?;
    entries
        .flatten()
        .filter(|e| e.file_name().to_str().map(is_bundle_name).unwrap_or(false))
        .max_by_key(|e| {
            e.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        })
        .map(|e| e.path())
}

/// Decode the accumulated stdout of `base64 <file>` (line wraps and blank
/// trailing lines included).
pub fn decode_base64_stream(text: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    base64::engine::general_purpose::STANDARD
        .decode(compact.as_bytes())
        .map_err(|e| format!("couldn't decode the fetched bundle: {e}"))
}

// ---- the Tauri command ----

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct BugReportResult {
    /// Local path of the bundle (for remote profiles: the fetched copy).
    pub path: String,
    /// The `ttbr-<hex>` id to quote in an issue.
    pub reference: Option<String>,
}

/// Collect a diagnostics bundle on the given target (None = local checkout)
/// and reveal it in the file manager. Progress lines stream as
/// `bugreport-line` events.
#[tauri::command]
pub async fn create_bug_report(
    app: tauri::AppHandle<Wry>,
    launcher_state: tauri::State<'_, crate::state::LauncherState>,
    profile: Option<Profile>,
) -> Result<BugReportResult, String> {
    let result = match profile {
        None => local_bug_report(&app, &launcher_state).await?,
        Some(profile) => remote_bug_report(&app, &profile).await?,
    };
    reveal(&app, &result.path);
    Ok(result)
}

async fn local_bug_report(
    app: &tauri::AppHandle<Wry>,
    state: &crate::state::LauncherState,
) -> Result<BugReportResult, String> {
    use tauri::Emitter;
    let checkout = state
        .checkout
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .or_else(|| crate::launcher::default_existing_checkout(app))
        .ok_or_else(|| "no local TT-Studio checkout to collect logs from".to_string())?;

    let spec = report_bug_spec(
        &checkout,
        crate::launcher::log_dir(app)?.join("bugreport.log"),
    );
    let (tx, rx) = std::sync::mpsc::channel();
    let line_app = app.clone();
    crate::launcher::spawn_streaming(
        &spec,
        state.child.clone(),
        move |line| {
            let _ = line_app.emit(BUGREPORT_LINE_EVENT, &line);
        },
        move |code| {
            let _ = tx.send(code);
        },
    )?;
    let code = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "run.py --report-bug ended without an exit code".to_string())?;
    if code != Some(0) {
        return Err(format!(
            "run.py --report-bug failed (exit {})",
            code.map_or("signal".to_string(), |c| c.to_string())
        ));
    }

    let zip = newest_bundle_in(&checkout)
        .ok_or_else(|| "the bundle finished but no ZIP appeared in logs/".to_string())?;
    Ok(BugReportResult {
        reference: zip
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(bundle_ref)
            .map(String::from),
        path: zip.display().to_string(),
    })
}

async fn remote_bug_report(
    app: &tauri::AppHandle<Wry>,
    profile: &Profile,
) -> Result<BugReportResult, String> {
    use tauri::Emitter;
    let session = crate::remote::connect_session(app, profile)
        .await
        .map_err(|e| e.to_string())?;
    let path = crate::remote::repo_path(profile);

    let run = async {
        let line_app = app.clone();
        let code = session
            .exec_stream(
                &report_bug_command(&path),
                |line| {
                    let _ = line_app.emit(BUGREPORT_LINE_EVENT, line);
                },
                |_| {},
            )
            .await
            .map_err(|e| e.to_string())?;
        if code != Some(0) {
            return Err(format!(
                "run.py --report-bug failed on {} (exit {})",
                profile.name,
                code.map_or("unknown".to_string(), |c| c.to_string())
            ));
        }

        let listing = session
            .exec_capture(&newest_bundle_command(&path))
            .await
            .map_err(|e| e.to_string())?;
        let remote_zip = listing.stdout.trim().to_string();
        if !listing.success() || remote_zip.is_empty() {
            return Err("the bundle finished but no ZIP appeared in the remote logs/".to_string());
        }
        let name = remote_zip
            .rsplit('/')
            .next()
            .unwrap_or(BUNDLE_PREFIX)
            .to_string();

        // Copy it back over the same session; no timeout — bundles can be
        // sizable and the caller cancels by closing the session.
        let mut encoded = String::new();
        let code = session
            .exec_stream(
                &fetch_bundle_command(&remote_zip),
                |line| {
                    encoded.push_str(line);
                    encoded.push('\n');
                },
                |_| {},
            )
            .await
            .map_err(|e| e.to_string())?;
        if code != Some(0) {
            return Err("couldn't read the bundle back from the remote machine".to_string());
        }
        let bytes = decode_base64_stream(&encoded)?;

        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("bug-reports");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let local = dir.join(&name);
        std::fs::write(&local, bytes).map_err(|e| e.to_string())?;
        Ok(BugReportResult {
            reference: bundle_ref(&name).map(String::from),
            path: local.display().to_string(),
        })
    };
    let result = run.await;
    session.close().await;
    result
}

/// Best-effort "show it in the file manager"; the returned path is the
/// deliverable either way.
fn reveal(app: &tauri::AppHandle<Wry>, path: &str) {
    use tauri_plugin_opener::OpenerExt;
    let _ = app.opener().reveal_item_in_dir(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn commands_quote_the_repo_path() {
        assert_eq!(
            report_bug_command("~/tt-studio"),
            "cd \"$HOME\"/'tt-studio' && python3 run.py --report-bug --no-browser 2>&1"
        );
        assert_eq!(
            newest_bundle_command("/opt/tt studio"),
            "ls -t '/opt/tt studio'/logs/tt-studio-logs-ttbr-*.zip 2>/dev/null | head -1"
        );
        assert_eq!(
            fetch_bundle_command("~/tt-studio/logs/tt-studio-logs-ttbr-ab.zip"),
            "base64 < \"$HOME\"/'tt-studio/logs/tt-studio-logs-ttbr-ab.zip'"
        );
    }

    #[test]
    fn local_spec_runs_report_bug_in_the_checkout() {
        let spec = report_bug_spec(Path::new("/tmp/stack"), "/tmp/log".into());
        assert_eq!(spec.args, ["run.py", "--report-bug", "--no-browser"]);
        assert_eq!(spec.cwd, Path::new("/tmp/stack"));
    }

    #[test]
    fn bundle_names_parse_to_references() {
        assert!(is_bundle_name("tt-studio-logs-ttbr-abc123.zip"));
        assert!(!is_bundle_name("tt-studio-logs-ttbr-abc123.tar"));
        assert!(!is_bundle_name("other.zip"));
        assert_eq!(
            bundle_ref("tt-studio-logs-ttbr-abc123.zip"),
            Some("ttbr-abc123")
        );
        assert_eq!(bundle_ref("random.zip"), None);
    }

    #[test]
    fn newest_bundle_wins_by_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs");
        std::fs::create_dir(&logs).unwrap();
        let old = logs.join("tt-studio-logs-ttbr-old111111111.zip");
        let new = logs.join("tt-studio-logs-ttbr-new222222222.zip");
        std::fs::write(&old, "old").unwrap();
        std::fs::write(&new, "new").unwrap();
        let earlier = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        let f = std::fs::File::options().write(true).open(&old).unwrap();
        f.set_modified(earlier).unwrap();
        std::fs::write(logs.join("startup.log"), "not a bundle").unwrap();

        assert_eq!(newest_bundle_in(dir.path()), Some(new));
        // No logs dir at all → None, not an error.
        assert_eq!(newest_bundle_in(&dir.path().join("nope")), None);
    }

    #[test]
    fn base64_stream_decodes_with_wrapping_and_whitespace() {
        let payload = b"PK\x03\x04 fake zip bytes".repeat(10);
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&payload);
        // Simulate `base64` line-wrapping at 76 columns plus a trailing newline.
        let wrapped: String = encoded
            .as_bytes()
            .chunks(76)
            .map(|c| String::from_utf8_lossy(c).into_owned())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        assert_eq!(decode_base64_stream(&wrapped).unwrap(), payload);
        assert!(decode_base64_stream("!!! not base64 !!!").is_err());
    }
}
