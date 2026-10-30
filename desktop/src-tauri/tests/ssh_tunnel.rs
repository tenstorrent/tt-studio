// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Integration tests for the SSH tunnel engine against a real containerized
//! sshd (tests/fixtures/sshd, shared via tests/common). Marked `#[ignore]`
//! so plain `cargo test` stays hermetic; CI runs them on Linux with
//! `cargo test --test ssh_tunnel -- --ignored`, and they also skip
//! gracefully at runtime when Docker (with Linux containers) is missing.
//!
//! The fixture maps a random free host port to the container's sshd, and
//! every local listener binds port 0 — the tests never touch the live
//! TT-Studio stack's ports (3000/8000-8002/4000/8080/8111).

mod common;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use common::{
    channel_sink, docker_has_linux_containers, http_get_through, keygen, trust_fixture_key,
    wait_for, SshdFixture,
};

use tt_studio_desktop_lib::ssh::known_hosts::{trust, KnownHostsVerifier};
use tt_studio_desktop_lib::ssh::session::SshSession;
use tt_studio_desktop_lib::ssh::tunnel::{
    Connector, ForwardSpec, Supervisor, SupervisorConfig, TunnelPhase,
};
use tt_studio_desktop_lib::ssh::{SshError, SshTransport};

/// Marker served by the httpd inside the fixture container on 127.0.0.1:8088.
const REMOTE_HTTP_PORT: u16 = 8088;
const MARKER: &str = "tt-studio-tunnel-fixture";

fn connector_for(fixture: &SshdFixture, known_hosts: PathBuf) -> Connector {
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

fn supervisor_config() -> SupervisorConfig {
    SupervisorConfig {
        // Local port 0 → high random port; never the live stack's ports.
        forwards: vec![ForwardSpec {
            local_port: 0,
            remote_host: "127.0.0.1".into(),
            remote_port: REMOTE_HTTP_PORT,
        }],
        initial_backoff: Duration::from_millis(500),
        max_backoff: Duration::from_secs(2),
        max_attempts: 30,
        ..Default::default()
    }
}

macro_rules! require_docker {
    () => {
        if !docker_has_linux_containers() {
            eprintln!("skipping: docker with Linux containers is not available");
            return;
        }
    };
}

// ---- the tests ----

#[tokio::test]
#[ignore = "needs docker; run with --ignored (desktop-ci does on Linux)"]
async fn key_auth_tofu_accept_and_forward_round_trip() {
    require_docker!();
    let fixture = SshdFixture::start();
    let tmp = tempfile::tempdir().unwrap();
    let known_hosts = tmp.path().join("known_hosts");

    // First contact: unknown key → trust it (the TOFU accept path).
    trust_fixture_key(&fixture, &known_hosts).await;

    // Second connect authenticates with the key file against the now-trusted
    // host, and the tunnel forwards a real HTTP round trip.
    let (sink, mut rx) = channel_sink();
    let sup = Supervisor::spawn(
        supervisor_config(),
        connector_for(&fixture, known_hosts),
        sink,
    );
    let connected = wait_for(&mut rx, "connected", |s| {
        matches!(s.phase, TunnelPhase::Connected)
    })
    .await;
    let local_port = connected.forwards[0].local_port;
    assert_ne!(local_port, 0);

    let response = http_get_through(local_port).await;
    assert!(
        response.contains(MARKER),
        "expected fixture marker in response, got:\n{response}"
    );
    sup.stop().await;
}

#[tokio::test]
#[ignore = "needs docker; run with --ignored (desktop-ci does on Linux)"]
async fn tunnel_reconnects_after_container_restart() {
    require_docker!();
    let fixture = SshdFixture::start();
    let tmp = tempfile::tempdir().unwrap();
    let known_hosts = tmp.path().join("known_hosts");
    trust_fixture_key(&fixture, &known_hosts).await;

    let (sink, mut rx) = channel_sink();
    let sup = Supervisor::spawn(
        supervisor_config(),
        connector_for(&fixture, known_hosts),
        sink,
    );
    wait_for(&mut rx, "initial connect", |s| {
        matches!(s.phase, TunnelPhase::Connected)
    })
    .await;

    // Restart the container: the session dies, and because host keys are
    // baked into the image the reconnect must succeed against the SAME key.
    fixture.restart();
    wait_for(&mut rx, "reconnecting status", |s| {
        matches!(s.phase, TunnelPhase::Reconnecting { .. })
    })
    .await;
    let reconnected = wait_for(&mut rx, "reconnect", |s| {
        matches!(s.phase, TunnelPhase::Connected)
    })
    .await;

    let response = http_get_through(reconnected.forwards[0].local_port).await;
    assert!(response.contains(MARKER));
    sup.stop().await;
}

#[tokio::test]
#[ignore = "needs docker; run with --ignored (desktop-ci does on Linux)"]
async fn changed_host_key_is_rejected() {
    require_docker!();
    let fixture = SshdFixture::start();
    let tmp = tempfile::tempdir().unwrap();
    let known_hosts = tmp.path().join("known_hosts");

    // Record a DIFFERENT (freshly generated) key for the fixture's address —
    // the TOFU reject path: what a MITM or reinstalled machine looks like.
    let impostor = tmp.path().join("impostor_ed25519");
    keygen(&impostor);
    let impostor_pub = std::fs::read_to_string(impostor.with_extension("pub")).unwrap();
    trust(&known_hosts, "127.0.0.1", fixture.port, impostor_pub.trim()).unwrap();

    let err = SshSession::connect(
        &fixture.target(),
        KnownHostsVerifier::new(known_hosts.clone()),
    )
    .await
    .err()
    .expect("connect must fail against a changed host key");
    assert!(
        matches!(err, SshError::ChangedHostKey { .. }),
        "expected ChangedHostKey, got {err:?}"
    );
    assert!(err.is_fatal());

    // And the supervisor treats it as terminal — no retry storm.
    let (sink, mut rx) = channel_sink();
    let sup = Supervisor::spawn(
        supervisor_config(),
        connector_for(&fixture, known_hosts),
        sink,
    );
    let lost = wait_for(&mut rx, "lost status", |s| {
        matches!(s.phase, TunnelPhase::Lost { .. })
    })
    .await;
    assert!(matches!(
        lost.phase,
        TunnelPhase::Lost {
            error: SshError::ChangedHostKey { .. }
        }
    ));
    sup.stop().await;
}
