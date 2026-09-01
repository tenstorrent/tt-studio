// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! russh-backed implementation of [`SshTransport`].
//!
//! One [`SshSession`] is one authenticated SSH connection. Auth order is
//! ssh-agent first (every identity the agent offers), then the profile's key
//! file (decrypted with the keychain passphrase when one is stored). Host
//! keys are checked by the injected [`HostKeyVerifier`] during key exchange,
//! so an untrusted server is rejected before authentication ever starts.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Handle};
use russh::keys::{self, HashAlg, PrivateKeyWithHashAlg, PublicKey};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;

use super::{io_error, ForwardStream, HostKeyVerifier, SshError, SshTransport};

const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);
/// Keepalives without a reply before russh declares the session dead
/// (~30 s of silence with the interval above).
const KEEPALIVE_MAX: usize = 3;

/// Where and how to connect. Cloneable so the tunnel supervisor can redial
/// with identical parameters on every reconnect attempt.
#[derive(Clone, Debug)]
pub struct SshTarget {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// Auth methods in the order they will be attempted.
    pub auth: Vec<AuthMethod>,
}

#[derive(Clone, Debug)]
pub enum AuthMethod {
    /// Try every identity the local ssh-agent offers.
    Agent,
    /// A private key file, optionally protected by a passphrase.
    KeyFile {
        path: PathBuf,
        passphrase: Option<String>,
    },
}

/// russh event handler: delegates server-key checking to the verifier and
/// surfaces its typed error (unknown/changed key) as the connect error.
struct Checker {
    host: String,
    port: u16,
    verifier: Arc<dyn HostKeyVerifier>,
}

impl client::Handler for Checker {
    type Error = SshError;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        self.verifier.verify(&self.host, self.port, key)?;
        Ok(true)
    }
}

pub struct SshSession {
    handle: Handle<Checker>,
}

impl SshSession {
    /// Connect and authenticate. Fails with a typed [`SshError`] naming the
    /// exact failure mode (dns / refused / timeout / host key / auth).
    pub async fn connect(
        target: &SshTarget,
        verifier: Arc<dyn HostKeyVerifier>,
    ) -> Result<Self, SshError> {
        let stream = dial(&target.host, target.port).await?;

        let config = Arc::new(client::Config {
            keepalive_interval: Some(KEEPALIVE_INTERVAL),
            keepalive_max: KEEPALIVE_MAX,
            ..Default::default()
        });
        let checker = Checker {
            host: target.host.clone(),
            port: target.port,
            verifier,
        };
        let mut handle = tokio::time::timeout(
            HANDSHAKE_TIMEOUT,
            client::connect_stream(config, stream, checker),
        )
        .await
        .map_err(|_| SshError::Timeout {
            message: format!("SSH handshake with {} timed out", target.host),
        })??;

        authenticate(&mut handle, target).await?;
        Ok(Self { handle })
    }

    /// Open a bare session channel — the building block for remote command
    /// execution (see `exec.rs`).
    pub(crate) async fn open_session_channel(
        &self,
    ) -> Result<russh::Channel<client::Msg>, SshError> {
        Ok(self.handle.channel_open_session().await?)
    }
}

/// Resolve and TCP-connect, classifying each failure mode separately.
async fn dial(host: &str, port: u16) -> Result<TcpStream, SshError> {
    let addrs: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| SshError::Dns {
            message: format!("{host}: {e}"),
        })?
        .collect();
    if addrs.is_empty() {
        return Err(SshError::Dns {
            message: format!("{host}: no addresses"),
        });
    }
    let mut last = None;
    for addr in addrs {
        match tokio::time::timeout(TCP_CONNECT_TIMEOUT, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => return Ok(stream),
            Ok(Err(e)) => last = Some(io_error(&e)),
            Err(_) => {
                last = Some(SshError::Timeout {
                    message: format!("connecting to {addr} timed out"),
                })
            }
        }
    }
    Err(last.unwrap_or(SshError::Internal {
        message: "no address to connect to".into(),
    }))
}

/// Try each configured method in order; collect why each one didn't work so
/// the final error tells the user the whole story.
async fn authenticate(handle: &mut Handle<Checker>, target: &SshTarget) -> Result<(), SshError> {
    let mut attempts: Vec<String> = Vec::new();
    for method in &target.auth {
        match method {
            AuthMethod::Agent => match agent_auth(handle, &target.user).await {
                Ok(()) => return Ok(()),
                Err(reason) => attempts.push(format!("agent: {reason}")),
            },
            AuthMethod::KeyFile { path, passphrase } => {
                // A broken key file is fatal (is_fatal) — retrying can't fix
                // it — but only after the agent has had its chance above.
                key_auth(handle, &target.user, path, passphrase.as_deref()).await?;
                return Ok(());
            }
        }
    }
    Err(SshError::AuthFailed {
        message: if attempts.is_empty() {
            "no authentication methods configured".into()
        } else {
            attempts.join("; ")
        },
    })
}

/// Authenticate with every identity the local ssh-agent offers. Returns a
/// human reason (not an [`SshError`]) when the agent path doesn't pan out,
/// so the caller can fall through to the next method.
async fn agent_auth(handle: &mut Handle<Checker>, user: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        let agent = keys::agent::client::AgentClient::connect_env()
            .await
            .map_err(|e| format!("not available ({e})"))?;
        agent_auth_with(handle, user, agent).await
    }
    #[cfg(windows)]
    {
        // OpenSSH-for-Windows service first (named pipe), then Pageant.
        match keys::agent::client::AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
            .await
        {
            Ok(agent) => agent_auth_with(handle, user, agent).await,
            Err(pipe_err) => {
                if pageant::is_pageant_running().await {
                    let agent = keys::agent::client::AgentClient::connect_pageant().await;
                    agent_auth_with(handle, user, agent).await
                } else {
                    Err(format!("not available ({pipe_err})"))
                }
            }
        }
    }
}

async fn agent_auth_with<S>(
    handle: &mut Handle<Checker>,
    user: &str,
    mut agent: keys::agent::client::AgentClient<S>,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("listing identities failed ({e})"))?;
    if identities.is_empty() {
        return Err("agent holds no identities".into());
    }
    let count = identities.len();
    for key in identities {
        let hash_alg = rsa_hash_for(handle, &key.algorithm()).await;
        match handle
            .authenticate_publickey_with(user, key, hash_alg, &mut agent)
            .await
        {
            Ok(AuthResult::Success) => return Ok(()),
            Ok(AuthResult::Failure { .. }) => continue,
            Err(e) => return Err(format!("signing via agent failed ({e})")),
        }
    }
    Err(format!("server rejected all {count} agent identities"))
}

async fn key_auth(
    handle: &mut Handle<Checker>,
    user: &str,
    path: &std::path::Path,
    passphrase: Option<&str>,
) -> Result<(), SshError> {
    let key = keys::load_secret_key(path, passphrase).map_err(|e| SshError::KeyFile {
        path: path.display().to_string(),
        message: match e {
            keys::Error::KeyIsEncrypted => {
                "key is passphrase-protected and no passphrase is stored".into()
            }
            other => other.to_string(),
        },
    })?;
    let hash_alg = rsa_hash_for(handle, &key.algorithm()).await;
    let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg);
    match handle.authenticate_publickey(user, key).await? {
        AuthResult::Success => Ok(()),
        AuthResult::Failure { .. } => Err(SshError::AuthFailed {
            message: format!("server rejected key file {}", path.display()),
        }),
    }
}

/// RSA keys need an explicit rsa-sha2-* choice; other algorithms ignore it.
async fn rsa_hash_for(handle: &Handle<Checker>, algorithm: &keys::Algorithm) -> Option<HashAlg> {
    if !algorithm.clone().is_rsa() {
        return None;
    }
    handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten()
}

#[async_trait::async_trait]
impl SshTransport for SshSession {
    async fn open_forward(
        &self,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Box<dyn ForwardStream>, SshError> {
        let channel = self
            .handle
            .channel_open_direct_tcpip(remote_host, remote_port as u32, "127.0.0.1", 0)
            .await?;
        Ok(Box::new(channel.into_stream()))
    }

    fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    async fn close(&self) {
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AcceptAll;
    impl HostKeyVerifier for AcceptAll {
        fn verify(&self, _: &str, _: u16, _: &PublicKey) -> Result<(), SshError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn unresolvable_host_reports_dns_error() {
        let target = SshTarget {
            host: "does-not-exist.invalid".into(),
            port: 22,
            user: "u".into(),
            auth: vec![],
        };
        let err = SshSession::connect(&target, Arc::new(AcceptAll))
            .await
            .err()
            .unwrap();
        assert!(matches!(err, SshError::Dns { .. }), "{err:?}");
    }

    #[tokio::test]
    async fn closed_port_reports_refused() {
        // Bind-then-drop leaves the port closed, but the OS hands ephemeral
        // ports out again quickly: if something else claims this one before
        // we dial it we get its behavior, not a refusal. Retry on a fresh
        // port rather than asserting against a lost race.
        let mut last = None;
        for _ in 0..5 {
            let port = {
                let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                l.local_addr().unwrap().port()
            };
            let target = SshTarget {
                host: "127.0.0.1".into(),
                port,
                user: "u".into(),
                auth: vec![],
            };
            let err = SshSession::connect(&target, Arc::new(AcceptAll))
                .await
                .err()
                .expect("connecting to a closed port must fail");
            if matches!(err, SshError::Refused { .. }) {
                return;
            }
            last = Some(err);
        }
        panic!("never saw a refusal; last error was {last:?}");
    }

    #[tokio::test]
    async fn non_ssh_server_reports_handshake_error() {
        // A listener that speaks garbage instead of an SSH banner.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut s, _)) = listener.accept().await {
                use tokio::io::AsyncWriteExt;
                let _ = s.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
            }
        });
        let target = SshTarget {
            host: "127.0.0.1".into(),
            port: addr.port(),
            user: "u".into(),
            auth: vec![],
        };
        let err = SshSession::connect(&target, Arc::new(AcceptAll))
            .await
            .err()
            .unwrap();
        assert!(
            matches!(
                err,
                SshError::Handshake { .. }
                    | SshError::Disconnected { .. }
                    | SshError::Timeout { .. }
            ),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn missing_key_file_reports_key_file_error() {
        let mut handle_err = None;
        // No server needed: load_secret_key fails before any auth traffic,
        // but key_auth needs a Handle, so exercise via the loader directly.
        if let Err(e) = keys::load_secret_key("/nonexistent/id_ed25519", None) {
            handle_err = Some(e.to_string());
        }
        assert!(handle_err.is_some());
    }
}
