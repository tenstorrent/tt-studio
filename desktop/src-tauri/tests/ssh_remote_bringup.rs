// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! End-to-end SSH mode against the containerized sshd fixture: the exec
//! probes classify the (down) fake stack, the bring-up command streams NDJSON
//! to `ready`, the stub "frontend" then answers through the tunnel's
//! forwarded port, and `run.py --stop` tears it back down — the whole
//! one-click connect flow minus the UI. Marked `#[ignore]` like the tunnel
//! tests; CI runs it on Linux with `--ignored`, and it skips gracefully when
//! Docker is missing. All local listeners bind port 0 (high random ports) —
//! the live TT-Studio stack's ports are never touched.

mod common;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{
    channel_sink, docker_has_linux_containers, http_get_through, trust_fixture_key, wait_for,
    SshdFixture,
};

use tt_studio_desktop_lib::remote::{self, PythonProbe, StackClassification};
use tt_studio_desktop_lib::ssh::known_hosts::KnownHostsVerifier;
use tt_studio_desktop_lib::ssh::session::SshSession;
use tt_studio_desktop_lib::ssh::tunnel::{
    Connector, ForwardSpec, Supervisor, SupervisorConfig, TunnelPhase,
};
use tt_studio_desktop_lib::ssh::SshTransport;

/// The fake checkout baked into the fixture image (HOME is /home/tunnel).
const REPO: &str = "~/tt-studio";
/// Served by fake_stack.py on the stack ports inside the container.
const STACK_MARKER: &str = "fake-tt-studio-stack ok";
/// The stub stack's ports inside the container (fake_stack.py).
const STACK_PORTS: [u16; 4] = [3000, 8000, 8001, 8002];

macro_rules! require_docker {
    () => {
        if !docker_has_linux_containers() {
            eprintln!("skipping: docker with Linux containers is not available");
            return;
        }
    };
}

async fn connect(fixture: &SshdFixture, known_hosts: &std::path::Path) -> SshSession {
    SshSession::connect(
        &fixture.target(),
        KnownHostsVerifier::new(known_hosts.to_path_buf()),
    )
    .await
    .expect("ssh connect")
}

fn stack_connector(fixture: &SshdFixture, known_hosts: PathBuf) -> Connector {
    let target = fixture.target();
    Arc::new(move || {
        let target = target.clone();
        let verifier = KnownHostsVerifier::new(known_hosts.clone());
        Box::pin(async move {
            SshSession::connect(&target, verifier)
                .await
                .map(|s| Arc::new(s) as Arc<dyn SshTransport>)
        })
    })
}

/// Forward every stub stack port to a random local port.
fn stack_forwards() -> SupervisorConfig {
    SupervisorConfig {
        forwards: STACK_PORTS
            .iter()
            .map(|&port| ForwardSpec {
                local_port: 0,
                remote_host: "127.0.0.1".into(),
                remote_port: port,
            })
            .collect(),
        initial_backoff: Duration::from_millis(500),
        max_backoff: Duration::from_secs(2),
        max_attempts: 30,
        ..Default::default()
    }
}

#[tokio::test]
#[ignore = "needs docker; run with --ignored (desktop-ci does on Linux)"]
async fn exec_captures_output_and_exit_codes() {
    require_docker!();
    let fixture = SshdFixture::start();
    let tmp = tempfile::tempdir().unwrap();
    let known_hosts = tmp.path().join("known_hosts");
    trust_fixture_key(&fixture, &known_hosts).await;
    let session = connect(&fixture, &known_hosts).await;

    let out = session
        .exec_capture("echo to-stdout; echo to-stderr 1>&2; exit 3")
        .await
        .unwrap();
    assert_eq!(out.exit_code, Some(3));
    assert_eq!(out.stdout, "to-stdout\n");
    assert_eq!(out.stderr, "to-stderr\n");

    // Streaming delivers whole lines in order despite SSH packet chunking.
    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = lines.clone();
    let exit = session
        .exec_stream(
            "for i in 1 2 3; do echo line-$i; done",
            |line| sink.lock().unwrap().push(line.to_string()),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(exit, Some(0));
    assert_eq!(*lines.lock().unwrap(), vec!["line-1", "line-2", "line-3"]);
    session.close().await;
}

#[tokio::test]
#[ignore = "needs docker; run with --ignored (desktop-ci does on Linux)"]
async fn one_click_flow_probes_brings_up_and_stops_the_remote_stack() {
    require_docker!();
    let fixture = SshdFixture::start();
    let tmp = tempfile::tempdir().unwrap();
    let known_hosts = tmp.path().join("known_hosts");
    trust_fixture_key(&fixture, &known_hosts).await;
    let session = connect(&fixture, &known_hosts).await;

    // ---- attach detection: probe python, checkout, and stack status ----

    let python = remote::parse_python_probe(
        &session
            .exec_capture(remote::python_version_command())
            .await
            .unwrap(),
    );
    assert!(python.meets_minimum(), "fixture python too old: {python:?}");
    assert!(matches!(python, PythonProbe::Found { major: 3, .. }));

    let run_py_exists = session
        .exec_capture(&remote::probe_run_py_command(REPO))
        .await
        .unwrap()
        .success();
    assert!(run_py_exists, "fake checkout missing from the image");

    // A wrong repo path classifies as no-checkout (the clone-instructions card).
    let missing = session
        .exec_capture(&remote::probe_run_py_command("~/nowhere"))
        .await
        .unwrap();
    assert!(!missing.success());
    assert_eq!(
        remote::classify(false, false, &python, None, "~/nowhere"),
        StackClassification::NoCheckout {
            path: "~/nowhere".into()
        }
    );

    let status = session
        .exec_capture(&remote::status_command(REPO))
        .await
        .unwrap();
    assert!(status.success(), "status failed: {}", status.stderr);
    let services = remote::parse_status_services(&status.stdout).expect("status event");
    assert_eq!(services.len(), 4);
    assert!(services.iter().all(|(_, up)| !up));
    assert_eq!(
        remote::classify(false, true, &python, Some(&services), REPO),
        StackClassification::Down,
        "a fresh fixture must classify as down (bring-up needed)"
    );

    // ---- tunnels up (random local ports → the stub stack's ports) ----

    let (sink, mut rx) = channel_sink();
    let sup = Supervisor::spawn(
        stack_forwards(),
        stack_connector(&fixture, known_hosts.clone()),
        sink,
    );
    let connected = wait_for(&mut rx, "tunnel connected", |s| {
        matches!(s.phase, TunnelPhase::Connected)
    })
    .await;
    let frontend_port = connected
        .forwards
        .iter()
        .find(|f| f.remote_port == 3000)
        .expect("frontend forward")
        .local_port;
    assert_ne!(frontend_port, 0);

    // ---- bring-up: stream NDJSON over ssh exec until ready ----

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let line_sink = lines.clone();
    let exit = session
        .exec_stream(
            &remote::bring_up_command(REPO),
            |line| line_sink.lock().unwrap().push(line.to_string()),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(
        exit,
        Some(0),
        "bring-up failed: {:?}",
        lines.lock().unwrap()
    );

    let events: Vec<serde_json::Value> = lines
        .lock()
        .unwrap()
        .iter()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    assert!(
        events.iter().any(|e| e["event"] == "phase_begin"),
        "no phases in {events:?}"
    );
    let ready = events
        .iter()
        .find(|e| e["event"] == "ready")
        .expect("bring-up must end with a ready event");
    assert_eq!(ready["detail"]["urls"]["app"], "http://localhost:3000");

    // ---- the forwarded "frontend" answers through the tunnel ----

    let response = http_get_through(frontend_port).await;
    assert!(
        response.contains(STACK_MARKER),
        "expected stub stack marker through the tunnel, got:\n{response}"
    );

    // Re-probing now reports every service healthy → the flow would attach.
    let status = session
        .exec_capture(&remote::status_command(REPO))
        .await
        .unwrap();
    let services = remote::parse_status_services(&status.stdout).expect("status event");
    assert!(services.iter().all(|(_, up)| *up));
    assert_eq!(
        remote::classify(true, true, &python, Some(&services), REPO),
        StackClassification::Healthy
    );

    // ---- stop on quit: run.py --stop tears the stack down ----

    let stop = session
        .exec_capture(&remote::stop_command(REPO))
        .await
        .unwrap();
    assert!(stop.success(), "--stop failed: {}", stop.stdout);
    assert!(stop.stdout.contains("Stopped the TT-Studio stack."));

    let after = session
        .exec_capture(&remote::status_command(REPO))
        .await
        .unwrap();
    let services = remote::parse_status_services(&after.stdout).expect("status event");
    assert!(
        services.iter().all(|(_, up)| !up),
        "stack still up after --stop: {services:?}"
    );

    session.close().await;
    sup.stop().await;
}
