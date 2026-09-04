// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Shared containerized-sshd fixture for the SSH integration tests
//! (`ssh_tunnel.rs`, `ssh_remote_bringup.rs`).
//!
//! The image (tests/fixtures/sshd) bundles a locked-down pubkey-only sshd, a
//! busybox httpd marker service, and a fake tt-studio checkout at
//! `/home/tunnel/tt-studio` whose `run.py` speaks the real `--json-events` /
//! `--status --json` / `--stop` protocol. Each fixture maps a random free
//! host port to the container's sshd; local listeners in tests always bind
//! port 0 — the live TT-Studio stack's ports are never touched.

#![allow(dead_code)] // each test binary uses a subset of the helpers

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
use tt_studio_desktop_lib::ssh::tunnel::{StatusSink, TunnelStatus};
use tt_studio_desktop_lib::ssh::SshError;

pub const IMAGE: &str = "tt-studio-desktop-sshd-fixture";

pub fn docker_has_linux_containers() -> bool {
    Command::new("docker")
        .args(["info", "--format", "{{.OSType}}"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "linux")
        .unwrap_or(false)
}

/// Build the fixture image once per test binary.
pub fn ensure_image() {
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

pub fn free_port() -> u16 {
    // Bind-then-drop; the OS hands out a free high port. Tiny race window,
    // acceptable for tests.
    StdTcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub struct SshdFixture {
    pub name: String,
    pub port: u16,
    /// Holds authorized_keys + the client key pair for this container.
    keys_dir: tempfile::TempDir,
}

impl SshdFixture {
    pub fn start() -> Self {
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

    pub fn key_path(&self) -> PathBuf {
        self.keys_dir.path().join("id_ed25519")
    }

    pub fn restart(&self) {
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

    pub fn target(&self) -> SshTarget {
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

pub fn keygen(path: &Path) {
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

pub fn channel_sink() -> (StatusSink, mpsc::UnboundedReceiver<TunnelStatus>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let sink: StatusSink = Arc::new(move |s| {
        let _ = tx.send(s);
    });
    (sink, rx)
}

pub async fn wait_for(
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

/// TOFU-accept the fixture's host key into `known_hosts` by connecting once,
/// harvesting the UnknownHostKey error, and persisting the offered key.
pub async fn trust_fixture_key(fixture: &SshdFixture, known_hosts: &Path) {
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

pub async fn http_get_through(port: u16) -> String {
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
