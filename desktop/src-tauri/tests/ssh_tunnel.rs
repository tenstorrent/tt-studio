// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Integration tests for the SSH tunnel engine against a real containerized
//! sshd (tests/fixtures/sshd). Marked `#[ignore]` so plain `cargo test`
//! stays hermetic; CI runs them on Linux with
//! `cargo test --test ssh_tunnel -- --ignored`, and they also skip
//! gracefully at runtime when Docker (with Linux containers) is missing.
//!
//! The fixture maps a random free host port to the container's sshd, and
//! every local listener binds port 0 — the tests never touch the live
//! TT-Studio stack's ports (3000/8000-8002/4000/8080/8111).

use std::net::TcpListener as StdTcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Once};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use tt_studio_desktop_lib::ssh::known_hosts::{trust, KnownHostsVerifier};
use tt_studio_desktop_lib::ssh::session::{AuthMethod, SshSession, SshTarget};
use tt_studio_desktop_lib::ssh::tunnel::{
    Connector, ForwardSpec, StatusSink, Supervisor, SupervisorConfig, TunnelPhase, TunnelStatus,
};
use tt_studio_desktop_lib::ssh::{SshError, SshTransport};

const IMAGE: &str = "tt-studio-desktop-sshd-fixture";
/// Marker served by the httpd inside the fixture container on 127.0.0.1:8088.
const REMOTE_HTTP_PORT: u16 = 8088;
const MARKER: &str = "tt-studio-tunnel-fixture";

// ---- fixture management ----

fn docker_has_linux_containers() -> bool {
    Command::new("docker")
        .args(["info", "--format", "{{.OSType}}"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "linux")
        .unwrap_or(false)
}

/// Build the fixture image once per test binary.
fn ensure_image() {
    static BUILD: Once = Once::new();
    BUILD.call_once(|| {
        let context = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sshd");
        let out = Command::new("docker")
            .args(["build", "-t", IMAGE])
            .arg(&context)
            .output()
            .expect("docker build failed to spawn");
        assert!(
            out.status.success(),
            "docker build failed:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
    });
}

fn free_port() -> u16 {
    // Bind-then-drop; the OS hands out a free high port. Tiny race window,
    // acceptable for tests.
    StdTcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

struct SshdFixture {
    name: String,
    port: u16,
    /// Holds authorized_keys + the client key pair for this container.
    keys_dir: tempfile::TempDir,
}

impl SshdFixture {
    fn start() -> Self {
        ensure_image();
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let name = format!(
            "tt-studio-sshd-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let keys_dir = tempfile::tempdir().unwrap();

        // Fresh client key pair per container, mounted as authorized_keys.
        let key_path = keys_dir.path().join("id_ed25519");
        keygen(&key_path);
        std::fs::copy(
            key_path.with_extension("pub"),
            keys_dir.path().join("authorized_keys"),
        )
        .unwrap();

        let port = free_port();
        let out = Command::new("docker")
            .args([
                "run",
                "-d",
                "--name",
                &name,
                "-p",
                &format!("127.0.0.1:{port}:22"),
                "-v",
                &format!("{}:/keys:ro", keys_dir.path().display()),
                IMAGE,
            ])
            .output()
            .expect("docker run failed to spawn");
        assert!(
            out.status.success(),
            "docker run failed:\n{}",
            String::from_utf8_lossy(&out.stderr)
        );

        let fixture = Self {
            name,
            port,
            keys_dir,
        };
        fixture.wait_for_sshd();
        fixture
    }

    fn key_path(&self) -> PathBuf {
        self.keys_dir.path().join("id_ed25519")
    }

    fn restart(&self) {
        let out = Command::new("docker")
            .args(["restart", "-t", "0", &self.name])
            .output()
            .expect("docker restart failed to spawn");
        assert!(out.status.success());
        self.wait_for_sshd();
    }

    /// Poll until sshd answers with its banner (docker start is async).
    fn wait_for_sshd(&self) {
        for _ in 0..120 {
            if let Ok(stream) = std::net::TcpStream::connect(("127.0.0.1", self.port)) {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut buf = [0u8; 4];
                use std::io::Read;
                let mut stream = stream;
                if stream.read_exact(&mut buf).is_ok() && &buf == b"SSH-" {
                    return;
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        panic!(
            "sshd fixture {} never came up on port {}",
            self.name, self.port
        );
    }

    fn target(&self) -> SshTarget {
        SshTarget {
            host: "127.0.0.1".into(),
            port: self.port,
            // Key file only: keeps the test independent of whatever
            // identities the developer's ssh-agent happens to hold.
            user: "tunnel".into(),
            auth: vec![AuthMethod::KeyFile {
                path: self.key_path(),
                passphrase: None,
            }],
        }
    }
}

impl Drop for SshdFixture {
    fn drop(&mut self) {
        let _ = Command::new("docker")
            .args(["rm", "-f", &self.name])
            .output();
    }
}

fn keygen(path: &Path) {
    let out = Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-q", "-f"])
        .arg(path)
        .output()
        .expect("ssh-keygen failed to spawn");
    assert!(
        out.status.success(),
        "ssh-keygen failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

// ---- helpers shared by the tests ----

fn channel_sink() -> (StatusSink, mpsc::UnboundedReceiver<TunnelStatus>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let sink: StatusSink = Arc::new(move |s| {
        let _ = tx.send(s);
    });
    (sink, rx)
}

async fn wait_for(
    rx: &mut mpsc::UnboundedReceiver<TunnelStatus>,
    what: &str,
    pred: impl Fn(&TunnelStatus) -> bool,
) -> TunnelStatus {
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let status = rx.recv().await.expect("status stream ended");
            if pred(&status) {
                return status;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}

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

/// TOFU-accept the fixture's host key into `known_hosts` by connecting once,
/// harvesting the UnknownHostKey error, and persisting the offered key.
async fn trust_fixture_key(fixture: &SshdFixture, known_hosts: &Path) {
    let err = SshSession::connect(
        &fixture.target(),
        KnownHostsVerifier::new(known_hosts.to_path_buf()),
    )
    .await
    .err()
    .expect("first contact must fail with an unknown host key");
    match err {
        SshError::UnknownHostKey {
            host,
            port,
            fingerprint,
            public_key,
            ..
        } => {
            assert!(fingerprint.starts_with("SHA256:"));
            trust(known_hosts, &host, port, &public_key).unwrap();
        }
        other => panic!("expected UnknownHostKey, got {other:?}"),
    }
}

async fn http_get_through(port: u16) -> String {
    let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connect to forwarded port");
    sock.write_all(b"GET / HTTP/1.0\r\nHost: fixture\r\n\r\n")
        .await
        .unwrap();
    let mut body = Vec::new();
    let _ = sock.read_to_end(&mut body).await;
    String::from_utf8_lossy(&body).to_string()
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
