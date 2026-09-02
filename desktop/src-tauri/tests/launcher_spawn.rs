// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Integration tests for launcher::spawn_streaming, driven against
//! tests/fixtures/fake_run.py — a stand-in run.py that emits the canned
//! `--json-events` NDJSON streams (success incl. ready, failure with
//! remediation, prompt_blocked, slow progress). No real bring-up anywhere.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tt_studio_desktop_lib::launcher::{
    bring_up_spec, kill_child, spawn_streaming, stop_spec, SpawnSpec,
};
use tt_studio_desktop_lib::state::ChildSlot;

const STREAM_TIMEOUT: Duration = Duration::from_secs(60);

/// The spec builders hardcode `python3` (the Linux target); CI runners may
/// only have `python` on PATH, so tests pick whichever answers.
fn python() -> String {
    if let Ok(p) = std::env::var("PYTHON") {
        return p;
    }
    for candidate in ["python3", "python"] {
        let works = std::process::Command::new(candidate)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if works {
            return candidate.to_string();
        }
    }
    panic!("no python interpreter on PATH (set PYTHON to override)");
}

/// A temp "checkout": fake_run.py copied in as run.py, so the fixture's
/// cwd assertion doubles as a test of the spawner's cwd contract.
fn fake_checkout(dir: &Path) -> PathBuf {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("fake_run.py");
    std::fs::copy(&fixture, dir.join("run.py")).unwrap();
    dir.to_path_buf()
}

enum Msg {
    Line(String),
    Exit(Option<i32>),
}

fn spawn(spec: &SpawnSpec, slot: &ChildSlot) -> mpsc::Receiver<Msg> {
    let (tx, rx) = mpsc::channel();
    let line_tx = tx.clone();
    spawn_streaming(
        spec,
        slot.clone(),
        move |line| {
            let _ = line_tx.send(Msg::Line(line));
        },
        move |code| {
            let _ = tx.send(Msg::Exit(code));
        },
    )
    .expect("spawn failed");
    rx
}

/// Drain the stream until the exit notification, collecting stdout lines.
fn wait_exit(rx: &mpsc::Receiver<Msg>, lines: &mut Vec<String>) -> Option<i32> {
    loop {
        match rx.recv_timeout(STREAM_TIMEOUT).expect("launcher timed out") {
            Msg::Line(line) => lines.push(line),
            Msg::Exit(code) => return code,
        }
    }
}

fn scenario_spec(dir: &Path, scenario: &str) -> SpawnSpec {
    let checkout = fake_checkout(dir);
    let mut spec = bring_up_spec(&checkout, dir.join("logs").join("bringup.log"), false);
    spec.program = python();
    spec.envs
        .push(("FAKE_RUN_SCENARIO".to_string(), scenario.to_string()));
    spec
}

fn event_type(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    Some(value.get("event")?.as_str()?.to_string())
}

#[test]
fn success_stream_ends_in_ready_and_a_clean_exit() {
    let dir = tempfile::tempdir().unwrap();
    let spec = scenario_spec(dir.path(), "success");
    let slot = ChildSlot::default();
    let rx = spawn(&spec, &slot);

    let mut lines = Vec::new();
    let code = wait_exit(&rx, &mut lines);
    assert_eq!(code, Some(0));

    // Every stdout line is valid NDJSON (stderr noise went to the log file).
    let events: Vec<String> = lines.iter().filter_map(|l| event_type(l)).collect();
    assert_eq!(events.len(), lines.len(), "non-JSON on stdout: {lines:?}");
    assert_eq!(events.first().map(String::as_str), Some("phase_begin"));
    assert_eq!(events.last().map(String::as_str), Some("ready"));

    // The child is reaped: slot free again.
    assert!(slot.lock().unwrap().is_none());

    // stderr was captured to the log file, not mixed into the stream.
    let log = std::fs::read_to_string(spec.stderr_log.clone()).unwrap();
    assert!(log.contains("stderr"), "{log}");
}

#[test]
fn failure_stream_carries_remediation_and_nonzero_exit() {
    let dir = tempfile::tempdir().unwrap();
    let spec = scenario_spec(dir.path(), "failure");
    let slot = ChildSlot::default();
    let rx = spawn(&spec, &slot);

    let mut lines = Vec::new();
    let code = wait_exit(&rx, &mut lines);
    assert_eq!(code, Some(1));

    let error_line = lines
        .iter()
        .find(|l| event_type(l).as_deref() == Some("error"))
        .expect("no error event in failure stream");
    assert!(error_line.contains("remediation"), "{error_line}");
    assert!(error_line.contains("port 8001"), "{error_line}");
}

#[test]
fn blocked_prompt_exits_2_instead_of_hanging() {
    let dir = tempfile::tempdir().unwrap();
    let spec = scenario_spec(dir.path(), "prompt_blocked");
    let slot = ChildSlot::default();
    let rx = spawn(&spec, &slot);

    let mut lines = Vec::new();
    // stdin is null and the fixture never reads it — if the spawner ever
    // left a prompt attached, this would hit the 60s stream timeout.
    let code = wait_exit(&rx, &mut lines);
    assert_eq!(code, Some(2));
    assert!(lines
        .iter()
        .any(|l| event_type(l).as_deref() == Some("prompt_blocked")));
}

#[test]
fn kill_terminates_a_slow_bring_up_and_frees_the_slot() {
    let dir = tempfile::tempdir().unwrap();
    let spec = scenario_spec(dir.path(), "slow");
    let slot = ChildSlot::default();
    let rx = spawn(&spec, &slot);

    // Wait until the child demonstrably streams, then kill it mid-phase.
    match rx.recv_timeout(STREAM_TIMEOUT).expect("no first line") {
        Msg::Line(_) => {}
        Msg::Exit(code) => panic!("slow child exited early: {code:?}"),
    }
    assert!(kill_child(&slot), "kill reported no child to signal");

    let mut lines = Vec::new();
    let code = wait_exit(&rx, &mut lines);
    assert_ne!(code, Some(0), "killed child reported success");
    assert!(
        slot.lock().unwrap().is_none(),
        "child not reaped after kill"
    );

    // The slot is genuinely reusable: run the (fake) --stop path in it.
    let mut stop = stop_spec(dir.path(), dir.path().join("logs").join("stop.log"));
    stop.program = python();
    let stop_rx = spawn(&stop, &slot);
    let mut stop_lines = Vec::new();
    assert_eq!(wait_exit(&stop_rx, &mut stop_lines), Some(0));
    assert!(stop_lines.iter().any(|l| l.contains("stopping")));
}

#[test]
fn second_spawn_while_running_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let spec = scenario_spec(dir.path(), "slow");
    let slot = ChildSlot::default();
    let rx = spawn(&spec, &slot);
    match rx.recv_timeout(STREAM_TIMEOUT).expect("no first line") {
        Msg::Line(_) => {}
        Msg::Exit(code) => panic!("slow child exited early: {code:?}"),
    }

    let err = spawn_streaming(&spec, slot.clone(), |_| {}, |_| {}).unwrap_err();
    assert!(err.contains("already running"), "{err}");

    kill_child(&slot);
    let mut lines = Vec::new();
    wait_exit(&rx, &mut lines);
}

#[test]
fn stderr_log_rotates_between_runs() {
    let dir = tempfile::tempdir().unwrap();
    let spec = scenario_spec(dir.path(), "success");
    let slot = ChildSlot::default();

    let rx = spawn(&spec, &slot);
    wait_exit(&rx, &mut Vec::new());
    let rx = spawn(&spec, &slot);
    wait_exit(&rx, &mut Vec::new());

    assert!(spec.stderr_log.exists());
    let rotated = spec.stderr_log.with_extension("log.1");
    assert!(rotated.exists(), "previous run's log was not kept");
}

#[test]
fn report_bug_run_produces_a_findable_bundle() {
    use tt_studio_desktop_lib::bug_report::{bundle_ref, newest_bundle_in, report_bug_spec};

    let dir = tempfile::tempdir().unwrap();
    let checkout = fake_checkout(dir.path());
    let mut spec = report_bug_spec(&checkout, dir.path().join("logs").join("bugreport.log"));
    spec.program = python();
    let slot = ChildSlot::default();
    let rx = spawn(&spec, &slot);

    let mut lines = Vec::new();
    let code = wait_exit(&rx, &mut lines);
    assert_eq!(code, Some(0));
    assert!(
        lines.iter().any(|l| l.contains("Bundle")),
        "no bundle progress line: {lines:?}"
    );

    let zip = newest_bundle_in(&checkout).expect("no bundle in logs/");
    assert!(zip.exists());
    let name = zip.file_name().unwrap().to_str().unwrap();
    assert_eq!(bundle_ref(name), Some("ttbr-abcdef123456"));
}
