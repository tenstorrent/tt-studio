// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! The launcher's own log files, surfaced to the logs viewer.
//!
//! Two directories hold everything the desktop shell writes:
//! - `app_data_dir/logs` — native `run.py` children: `bringup.log` (stderr),
//!   `bringup.ndjson` (the machine-readable stdout tee), `stop.log`,
//!   `switch.log`, and their `.1` rotations;
//! - `app_log_dir` — `remote-bringup.log` / `remote-bringup.ndjson` from the
//!   ssh bring-up path.
//!
//! The viewer only ever reads files these scans found — names are looked up
//! against the scan result, never joined into a path from UI input.

use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, Wry};

/// Reading more than this per request keeps the UI responsive on huge logs.
pub const MAX_TAIL_BYTES: u64 = 512 * 1024;

// ---- NDJSON tee: persist the bring-up event stream for the viewer ----

/// Append-only line sink for the NDJSON stdout stream. Failures degrade to
/// dropping the tee (the UI stream is unaffected) — logging must never block
/// or break a bring-up.
pub struct LineLog(Option<Mutex<File>>);

impl LineLog {
    /// Rotate like the stderr logs (keep one `.1` predecessor) and open fresh.
    pub fn create(path: &Path) -> Self {
        let file = crate::launcher::rotate_log(path)
            .ok()
            .and_then(|_| File::create(path).ok());
        Self(file.map(Mutex::new))
    }

    pub fn append(&self, line: &str) {
        if let Some(file) = &self.0 {
            if let Ok(mut f) = file.lock() {
                let _ = writeln!(f, "{line}");
            }
        }
    }
}

/// Append one line to a log file without rotation (remote path: the file is
/// recreated per bring-up by the caller).
pub fn append_line(file: &mut File, line: &str) {
    let _ = writeln!(file, "{line}");
}

/// The launcher's own event log: things the app did that a user may later ask
/// about. Picked up by the logs viewer and bundled by `bug_report.rs`, since
/// an action with no record is impossible to explain after the fact.
pub const LAUNCHER_LOG: &str = "launcher.log";

/// Append one timestamped line to the launcher log. Best-effort: a log write
/// must never be the reason something fails.
pub fn append_app_line(app: &tauri::AppHandle<Wry>, line: &str) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LAUNCHER_LOG))
    {
        let _ = writeln!(file, "[{stamp}] {line}");
    }
}

// ---- scanning ----

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LogFileInfo {
    /// Display name, unique across both directories.
    pub name: String,
    pub size_bytes: u64,
    /// Seconds since the Unix epoch, for sorting newest-first.
    pub modified_secs: u64,
    /// The stream is NDJSON events (level filtering applies).
    pub ndjson: bool,
}

fn is_log_name(name: &str) -> bool {
    name.ends_with(".log")
        || name.ends_with(".log.1")
        || name.ends_with(".ndjson")
        || name.ends_with(".ndjson.1")
}

/// Scan one directory for launcher log files.
pub fn scan_dir(dir: &Path) -> Vec<(LogFileInfo, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !path.is_file() || !is_log_name(name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let modified_secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        found.push((
            LogFileInfo {
                name: name.to_string(),
                size_bytes: meta.len(),
                modified_secs,
                ndjson: name.contains(".ndjson"),
            },
            path,
        ));
    }
    found
}

/// Read at most `MAX_TAIL_BYTES` from the end of the file, starting at the
/// first complete line when truncating.
pub fn read_tail(path: &Path) -> std::io::Result<(String, bool)> {
    let mut file = OpenOptions::new().read(true).open(path)?;
    let len = file.metadata()?.len();
    let truncated = len > MAX_TAIL_BYTES;
    if truncated {
        file.seek(SeekFrom::End(-(MAX_TAIL_BYTES as i64)))?;
    }
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    let mut content = String::from_utf8_lossy(&buf).into_owned();
    if truncated {
        // Drop the partial first line so parsers see whole lines only.
        if let Some(pos) = content.find('\n') {
            content = content.split_off(pos + 1);
        }
    }
    Ok((content, truncated))
}

// ---- Tauri commands ----

fn log_dirs(app: &tauri::AppHandle<Wry>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(dir) = crate::launcher::log_dir(app) {
        dirs.push(dir);
    }
    if let Ok(dir) = app.path().app_log_dir() {
        dirs.push(dir);
    }
    dirs
}

fn scan_all(app: &tauri::AppHandle<Wry>) -> Vec<(LogFileInfo, PathBuf)> {
    let mut all: Vec<(LogFileInfo, PathBuf)> =
        log_dirs(app).iter().flat_map(|d| scan_dir(d)).collect();
    // Newest first; duplicates (same name in both dirs) keep the newest.
    all.sort_by_key(|entry| std::cmp::Reverse(entry.0.modified_secs));
    let mut seen = std::collections::HashSet::new();
    all.retain(|(info, _)| seen.insert(info.name.clone()));
    all
}

fn resolve(app: &tauri::AppHandle<Wry>, name: &str) -> Result<PathBuf, String> {
    scan_all(app)
        .into_iter()
        .find(|(info, _)| info.name == name)
        .map(|(_, path)| path)
        .ok_or_else(|| format!("no launcher log named {name}"))
}

#[tauri::command]
pub fn list_app_logs(app: tauri::AppHandle<Wry>) -> Vec<LogFileInfo> {
    scan_all(&app).into_iter().map(|(info, _)| info).collect()
}

#[derive(Serialize, Clone, Debug)]
pub struct LogTail {
    pub content: String,
    /// Only the newest `MAX_TAIL_BYTES` are returned for oversized logs.
    pub truncated: bool,
}

#[tauri::command]
pub fn read_app_log(app: tauri::AppHandle<Wry>, name: String) -> Result<LogTail, String> {
    let path = resolve(&app, &name)?;
    let (content, truncated) = read_tail(&path).map_err(|e| e.to_string())?;
    Ok(LogTail { content, truncated })
}

/// Export one log via a native save dialog. Resolves to the chosen path, or
/// null when the user cancelled.
#[tauri::command]
pub async fn export_app_log(
    app: tauri::AppHandle<Wry>,
    name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let source = resolve(&app, &name)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&name)
        .save_file(move |chosen| {
            let _ = tx.send(chosen);
        });
    let Some(target) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let target = target
        .into_path()
        .map_err(|e| format!("unsupported save location: {e}"))?;
    std::fs::copy(&source, &target).map_err(|e| e.to_string())?;
    Ok(Some(target.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_finds_only_log_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            "bringup.log",
            "bringup.log.1",
            "bringup.ndjson",
            "notes.txt",
            ".env",
        ] {
            std::fs::write(dir.path().join(name), "x\n").unwrap();
        }
        std::fs::create_dir(dir.path().join("sub.log")).unwrap(); // dir, not file

        let mut names: Vec<String> = scan_dir(dir.path())
            .into_iter()
            .map(|(info, _)| info.name)
            .collect();
        names.sort();
        assert_eq!(names, ["bringup.log", "bringup.log.1", "bringup.ndjson"]);
    }

    #[test]
    fn scan_marks_ndjson_streams() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("bringup.ndjson"), "{}\n").unwrap();
        std::fs::write(dir.path().join("bringup.log"), "text\n").unwrap();
        for (info, _) in scan_dir(dir.path()) {
            assert_eq!(info.ndjson, info.name.contains("ndjson"), "{}", info.name);
        }
    }

    #[test]
    fn tail_returns_whole_small_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.log");
        std::fs::write(&path, "one\ntwo\n").unwrap();
        let (content, truncated) = read_tail(&path).unwrap();
        assert_eq!(content, "one\ntwo\n");
        assert!(!truncated);
    }

    #[test]
    fn tail_truncates_to_complete_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.log");
        let line = "x".repeat(1000);
        let mut body = String::new();
        for i in 0..600 {
            body.push_str(&format!("{i} {line}\n"));
        }
        std::fs::write(&path, &body).unwrap();

        let (content, truncated) = read_tail(&path).unwrap();
        assert!(truncated);
        assert!(content.len() as u64 <= MAX_TAIL_BYTES);
        // Starts at a line boundary, ends with the file's last line.
        assert!(!content.starts_with('x'));
        assert!(content.ends_with(&format!("599 {line}\n")));
        let first = content.lines().next().unwrap();
        assert!(first.split(' ').next().unwrap().parse::<u32>().is_ok());
    }

    #[test]
    fn line_log_appends_and_rotates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs").join("bringup.ndjson");

        let log = LineLog::create(&path);
        log.append(r#"{"v":1}"#);
        log.append(r#"{"v":2}"#);
        drop(log);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"v\":1}\n{\"v\":2}\n"
        );

        // A second create rotates the first run's stream aside.
        let log = LineLog::create(&path);
        log.append("fresh");
        drop(log);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "fresh\n");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("logs").join("bringup.ndjson.1")).unwrap(),
            "{\"v\":1}\n{\"v\":2}\n"
        );
    }

    #[test]
    fn line_log_swallows_unwritable_paths() {
        // A path whose parent can't be a directory: create fails, append is a no-op.
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "x").unwrap();
        let log = LineLog::create(&blocker.join("nested.ndjson"));
        log.append("dropped");
    }
}
