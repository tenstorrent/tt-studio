// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Native white-box launcher: spawn `python run.py` inside a checkout and
//! stream its NDJSON events to the UI.
//!
//! `run.py --json-events` keeps stdout machine-readable (one JSON object per
//! line) and moves all human output to stderr. So: stdout is read
//! line-buffered and each line is forwarded verbatim as a `bringup-line`
//! Tauri event (the frontend owns parsing — see src/lib/events.ts), while
//! stderr goes to a rotating log file in the app data dir for bug reports.
//!
//! Two contract details worth keeping in mind:
//! - `run.py` derives TT_STUDIO_ROOT from its cwd, so the child's cwd must
//!   be the checkout root.
//! - The bootstrap re-execs (execve) into `.tt_studio_run_venv`; PID and the
//!   stdout pipe survive that, so it's still one child from our side.

use crate::state::{ChildSlot, LauncherState};
use crate::{stack_checkout, state};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, Wry};

pub const BRINGUP_LINE_EVENT: &str = "bringup-line";
pub const BRINGUP_EXIT_EVENT: &str = "bringup-exit";
pub const STOP_LINE_EVENT: &str = "stop-line";

const PYTHON: &str = "python3";

/// Everything needed to spawn one launcher child.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub stderr_log: PathBuf,
    pub envs: Vec<(String, String)>,
}

/// Full bring-up. `--no-browser` because the desktop window is the browser;
/// `--json-events` for the machine-readable stream (implies non-interactive);
/// `--no-sudo` because a GUI child can never answer a sudo password prompt —
/// anything that genuinely needs root becomes a `prompt_blocked`/`error`
/// event pointing the user at a one-time terminal run instead of a hang.
pub fn bring_up_spec(checkout: &Path, stderr_log: PathBuf) -> SpawnSpec {
    SpawnSpec {
        program: PYTHON.to_string(),
        args: ["run.py", "--no-browser", "--json-events", "--no-sudo"]
            .map(String::from)
            .to_vec(),
        cwd: checkout.to_path_buf(),
        stderr_log,
        envs: Vec::new(),
    }
}

/// `run.py --stop`: stop containers, keep the persistent volume.
pub fn stop_spec(checkout: &Path, stderr_log: PathBuf) -> SpawnSpec {
    SpawnSpec {
        program: PYTHON.to_string(),
        args: ["run.py", "--stop"].map(String::from).to_vec(),
        cwd: checkout.to_path_buf(),
        stderr_log,
        envs: Vec::new(),
    }
}

/// One-deep rotation: keep the previous run's stderr as `<name>.1`.
pub fn rotate_log(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if path.exists() {
        let mut rotated = path.as_os_str().to_owned();
        rotated.push(".1");
        std::fs::rename(path, PathBuf::from(rotated))?;
    }
    Ok(())
}

/// Spawn the child described by `spec`, park it in `slot`, and stream its
/// stdout line by line to `on_line` from a reader thread. When stdout hits
/// EOF the same thread reaps the child and calls `on_exit` with its exit
/// code (None if killed by signal). Errors if `slot` is already occupied.
pub fn spawn_streaming(
    spec: &SpawnSpec,
    slot: ChildSlot,
    on_line: impl Fn(String) + Send + 'static,
    on_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> Result<u32, String> {
    let mut guard = slot.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("a launcher process is already running".to_string());
    }

    rotate_log(&spec.stderr_log).map_err(|e| format!("couldn't prepare stderr log: {e}"))?;
    let log = File::create(&spec.stderr_log).map_err(|e| e.to_string())?;

    let mut child = Command::new(&spec.program)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .envs(spec.envs.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", spec.program))?;

    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child has no stdout pipe".to_string())?;
    *guard = Some(child);
    drop(guard);

    let reaper_slot = slot.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => on_line(line),
                Err(_) => break,
            }
        }
        // EOF: take the child back out of the slot and reap it.
        let child = reaper_slot.lock().ok().and_then(|mut s| s.take());
        let code = child.and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        on_exit(code);
    });

    Ok(pid)
}

/// Signal the running child, if any. The reader thread reaps it on EOF.
pub fn kill_child(slot: &ChildSlot) -> bool {
    match slot.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(child) => child.kill().is_ok(),
            None => false,
        },
        Err(_) => false,
    }
}

// ---- Tauri commands ----

fn log_dir(app: &tauri::AppHandle<Wry>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs"))
}

fn checked_checkout(checkout: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(checkout);
    if !stack_checkout::is_valid_checkout(&path) {
        return Err(format!(
            "{checkout} is not a tt-studio checkout (no run.py)"
        ));
    }
    Ok(path)
}

fn spawn_bring_up(
    app: &tauri::AppHandle<Wry>,
    state: &state::LauncherState,
    checkout: &Path,
) -> Result<u32, String> {
    let spec = bring_up_spec(checkout, log_dir(app)?.join("bringup.log"));
    *state.checkout.lock().map_err(|e| e.to_string())? = Some(checkout.to_path_buf());
    state.local_stack.store(true, Ordering::SeqCst);
    let line_app = app.clone();
    let exit_app = app.clone();
    spawn_streaming(
        &spec,
        state.child.clone(),
        move |line| {
            let _ = line_app.emit(BRINGUP_LINE_EVENT, &line);
        },
        move |code| {
            // Same payload shape as the remote bring-up path (remote.rs), so
            // the frontend has a single `bringup-exit` handler. A signal
            // death has no exit code, which serializes as null.
            let _ = exit_app.emit(
                BRINGUP_EXIT_EVENT,
                crate::remote::BringUpExit {
                    exit_code: code.and_then(|c| u32::try_from(c).ok()),
                    error: None,
                },
            );
        },
    )
}

/// Start `run.py --no-browser --json-events` in the given checkout and
/// stream its stdout as `bringup-line` events; `bringup-exit` carries the
/// exit code when it ends.
#[tauri::command]
pub fn start_bring_up(
    app: tauri::AppHandle<Wry>,
    state: tauri::State<'_, LauncherState>,
    checkout: String,
) -> Result<u32, String> {
    let path = checked_checkout(&checkout)?;
    spawn_bring_up(&app, &state, &path)
}

/// Kill the running launcher child (if any). Returns whether a signal was
/// actually sent.
#[tauri::command]
pub fn stop_bring_up(state: tauri::State<'_, LauncherState>) -> bool {
    kill_child(&state.child)
}

#[tauri::command]
pub fn bring_up_running(state: tauri::State<'_, LauncherState>) -> bool {
    state.child.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// The UI attached to an already-healthy local stack (no bring-up spawned).
/// Recorded so quitting can still offer to stop that stack.
#[tauri::command]
pub fn mark_local_attach(state: tauri::State<'_, LauncherState>) {
    state.local_stack.store(true, Ordering::SeqCst);
}

/// Explicit restart: `run.py --stop` (streamed as `stop-line` events), then
/// a fresh bring-up. Never triggered automatically — only by the launcher
/// UI's "Restart stack" action.
#[tauri::command]
pub async fn restart_stack(
    app: tauri::AppHandle<Wry>,
    state: tauri::State<'_, LauncherState>,
    checkout: String,
) -> Result<u32, String> {
    let path = checked_checkout(&checkout)?;
    let logs = log_dir(&app)?;

    let (tx, rx) = std::sync::mpsc::channel();
    let line_app = app.clone();
    spawn_streaming(
        &stop_spec(&path, logs.join("stop.log")),
        state.child.clone(),
        move |line| {
            let _ = line_app.emit(STOP_LINE_EVENT, &line);
        },
        move |code| {
            let _ = tx.send(code);
        },
    )?;
    let code = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "run.py --stop ended without reporting an exit code".to_string())?;
    if code != Some(0) {
        return Err(format!(
            "run.py --stop failed (exit {}) — not starting a new bring-up",
            code.map_or("signal".to_string(), |c| c.to_string())
        ));
    }

    spawn_bring_up(&app, &state, &path)
}

// ---- quit flow ----

/// Ask whether quitting should also stop the stack. The host services
/// detach and ignore SIGHUP on purpose, so "keep running in the background"
/// is the truthful default; "stop the stack" runs `run.py --stop` first.
///
/// Called from the CloseRequested handler with the close already prevented;
/// every branch ends in `app.exit(0)`.
pub fn confirm_quit(app: &tauri::AppHandle<Wry>) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let app = app.clone();
    app.clone()
        .dialog()
        .message(
            "TT-Studio's services keep running in the background — you can \
             reopen the app (or the browser) and pick up where you left off.\n\n\
             Stop the stack before quitting?",
        )
        .title("Quit TT-Studio")
        // "Stop the stack" is the affirmative (Ok) button so that dismissing
        // the dialog (Esc / close) maps to the safe default: keep running.
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Stop the stack".to_string(),
            "Keep running".to_string(),
        ))
        .show(move |stop_stack| {
            if stop_stack {
                stop_stack_then_exit(&app);
            } else {
                app.exit(0);
            }
        });
}

/// Kill any in-flight bring-up, run `run.py --stop` in the known checkout
/// (progress streamed as `stop-line` events for whoever is still listening),
/// then exit. Exits immediately if there is no checkout to stop.
fn stop_stack_then_exit(app: &tauri::AppHandle<Wry>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state: tauri::State<LauncherState> = app.state();

        // Free the child slot: signal a running bring-up and give its
        // reader thread a moment to reap it.
        kill_child(&state.child);
        for _ in 0..50 {
            if state.child.lock().map(|g| g.is_none()).unwrap_or(true) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        let checkout = state
            .checkout
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .or_else(|| default_existing_checkout(&app));
        let (Some(checkout), Ok(logs)) = (checkout, log_dir(&app)) else {
            app.exit(0);
            return;
        };

        let line_app = app.clone();
        let exit_app = app.clone();
        let spawned = spawn_streaming(
            &stop_spec(&checkout, logs.join("stop.log")),
            state.child.clone(),
            move |line| {
                let _ = line_app.emit(STOP_LINE_EVENT, &line);
            },
            move |_code| {
                exit_app.exit(0);
            },
        );
        if spawned.is_err() {
            app.exit(0);
        }
    });
}

/// Attached-but-never-spawned sessions still deserve a working "stop the
/// stack": fall back to the configured/managed checkout (never cloning).
fn default_existing_checkout(app: &tauri::AppHandle<Wry>) -> Option<PathBuf> {
    let configured = stack_checkout::configured_path(app).ok().flatten();
    let home = app.path().home_dir().ok()?;
    stack_checkout::existing(configured.as_deref(), &stack_checkout::managed_dir(&home))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bring_up_spec_runs_run_py_with_json_events_from_the_checkout() {
        let spec = bring_up_spec(Path::new("/tmp/stack"), PathBuf::from("/tmp/log"));
        assert_eq!(spec.program, "python3");
        assert_eq!(
            spec.args,
            ["run.py", "--no-browser", "--json-events", "--no-sudo"]
        );
        // run.py derives TT_STUDIO_ROOT from cwd — this is the contract.
        assert_eq!(spec.cwd, Path::new("/tmp/stack"));
    }

    #[test]
    fn stop_spec_runs_run_py_stop() {
        let spec = stop_spec(Path::new("/tmp/stack"), PathBuf::from("/tmp/log"));
        assert_eq!(spec.args, ["run.py", "--stop"]);
        assert_eq!(spec.cwd, Path::new("/tmp/stack"));
    }

    #[test]
    fn rotate_keeps_one_previous_log() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("logs").join("bringup.log");

        rotate_log(&log).unwrap(); // nothing to rotate, just mkdir
        std::fs::write(&log, "first run").unwrap();
        rotate_log(&log).unwrap();
        assert!(!log.exists());
        let rotated = dir.path().join("logs").join("bringup.log.1");
        assert_eq!(std::fs::read_to_string(&rotated).unwrap(), "first run");

        std::fs::write(&log, "second run").unwrap();
        rotate_log(&log).unwrap();
        assert_eq!(std::fs::read_to_string(&rotated).unwrap(), "second run");
    }
}
