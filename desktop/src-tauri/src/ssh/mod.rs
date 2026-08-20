// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! SSH tunnel engine for remote TT-Studio stacks.
//!
//! The desktop shell reaches a remote stack by forwarding the stack's ports
//! over one multiplexed SSH session (direct-tcpip channels behind local TCP
//! listeners). Everything speaks to the session through the small
//! [`SshTransport`] trait so the russh implementation in `session.rs` can be
//! swapped for ssh2 or system-ssh without touching the tunnel supervisor.

pub(crate) mod commands;
pub mod exec;
pub mod known_hosts;
pub mod session;
pub mod tunnel;

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncWrite};

/// Typed error for every way an SSH connection can fail. Serialized with a
/// `code` discriminant the UI can switch on (same contract as `SecretError`).
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SshError {
    /// Hostname didn't resolve.
    Dns { message: String },
    /// TCP connect was refused (host up, no sshd on that port).
    Refused { message: String },
    /// TCP connect or SSH handshake timed out.
    Timeout { message: String },
    /// Protocol/key-exchange failure once the socket was up.
    Handshake { message: String },
    /// No usable ssh-agent (socket missing, env unset, agent empty is NOT
    /// this — an empty agent just falls through to the next auth method).
    AgentUnavailable { message: String },
    /// Key file missing, unreadable, or the passphrase didn't decrypt it.
    KeyFile { path: String, message: String },
    /// Every configured auth method was tried and rejected by the server.
    AuthFailed { message: String },
    /// The server presented a key we have never seen. Carries everything the
    /// UI needs for a trust-on-first-use prompt.
    UnknownHostKey {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        /// Full key in OpenSSH format, passed back verbatim to
        /// `trust_host_key` if the user accepts.
        public_key: String,
    },
    /// The server's key DIFFERS from the one we trusted earlier. Never
    /// auto-recoverable: could be a reinstalled machine or a MITM.
    ChangedHostKey {
        host: String,
        port: u16,
        fingerprint: String,
    },
    /// The app-managed known_hosts file couldn't be read or written.
    KnownHosts { message: String },
    /// The session died after being established.
    Disconnected { message: String },
    /// Anything that doesn't fit the buckets above.
    Internal { message: String },
}

impl std::fmt::Display for SshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SshError::Dns { message } => write!(f, "DNS lookup failed: {message}"),
            SshError::Refused { message } => write!(f, "connection refused: {message}"),
            SshError::Timeout { message } => write!(f, "timed out: {message}"),
            SshError::Handshake { message } => write!(f, "SSH handshake failed: {message}"),
            SshError::AgentUnavailable { message } => {
                write!(f, "ssh-agent unavailable: {message}")
            }
            SshError::KeyFile { path, message } => {
                write!(f, "cannot use key file {path}: {message}")
            }
            SshError::AuthFailed { message } => write!(f, "authentication failed: {message}"),
            SshError::UnknownHostKey {
                host, fingerprint, ..
            } => write!(f, "unknown host key for {host}: {fingerprint}"),
            SshError::ChangedHostKey {
                host, fingerprint, ..
            } => write!(
                f,
                "HOST KEY CHANGED for {host} (now {fingerprint}) — refusing to connect"
            ),
            SshError::KnownHosts { message } => write!(f, "known_hosts error: {message}"),
            SshError::Disconnected { message } => write!(f, "connection lost: {message}"),
            SshError::Internal { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for SshError {}

impl SshError {
    /// Errors where retrying with the same inputs cannot succeed — the
    /// supervisor stops instead of burning reconnect attempts on them.
    pub fn is_fatal(&self) -> bool {
        matches!(
            self,
            SshError::UnknownHostKey { .. }
                | SshError::ChangedHostKey { .. }
                | SshError::AuthFailed { .. }
                | SshError::KeyFile { .. }
        )
    }
}

impl From<russh::Error> for SshError {
    fn from(err: russh::Error) -> Self {
        match err {
            russh::Error::IO(e) => io_error(&e),
            russh::Error::Disconnect | russh::Error::HUP => SshError::Disconnected {
                message: "server closed the connection".into(),
            },
            russh::Error::ConnectionTimeout | russh::Error::KeepaliveTimeout => SshError::Timeout {
                message: "SSH connection timed out".into(),
            },
            russh::Error::NoAuthMethod => SshError::AuthFailed {
                message: "server accepted none of our authentication methods".into(),
            },
            russh::Error::UnknownKey => SshError::Handshake {
                message: "server host key was rejected".into(),
            },
            other => SshError::Handshake {
                message: other.to_string(),
            },
        }
    }
}

impl From<russh::keys::Error> for SshError {
    fn from(err: russh::keys::Error) -> Self {
        SshError::Internal {
            message: err.to_string(),
        }
    }
}

/// Classify a raw socket error into the typed buckets the UI understands.
pub(crate) fn io_error(e: &std::io::Error) -> SshError {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::ConnectionRefused => SshError::Refused {
            message: e.to_string(),
        },
        ErrorKind::TimedOut => SshError::Timeout {
            message: e.to_string(),
        },
        ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted | ErrorKind::BrokenPipe => {
            SshError::Disconnected {
                message: e.to_string(),
            }
        }
        _ => SshError::Internal {
            message: e.to_string(),
        },
    }
}

/// Byte stream carried by one forwarded connection.
pub trait ForwardStream: AsyncRead + AsyncWrite + Send + Unpin {}
impl<T: AsyncRead + AsyncWrite + Send + Unpin> ForwardStream for T {}

/// The seam between the tunnel supervisor and the SSH implementation.
///
/// One value represents one authenticated session; the supervisor opens a
/// direct-tcpip channel per forwarded TCP connection. Implementations must be
/// cheap to share (`Arc<dyn SshTransport>`) and safe to call concurrently.
#[async_trait::async_trait]
pub trait SshTransport: Send + Sync {
    /// Open a forwarded byte stream to `host:port` as seen from the remote
    /// machine (direct-tcpip in SSH terms).
    async fn open_forward(
        &self,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<Box<dyn ForwardStream>, SshError>;

    /// True once the underlying session is dead. The supervisor polls this
    /// to trigger reconnects; keepalives make it flip within seconds of a
    /// silent network drop.
    fn is_closed(&self) -> bool;

    /// Graceful shutdown. Must be idempotent.
    async fn close(&self);
}

/// How the server proved its identity gets checked — implemented by the
/// app-managed known_hosts store, and by permissive stubs in tests.
pub trait HostKeyVerifier: Send + Sync {
    fn verify(&self, host: &str, port: u16, key: &russh::keys::PublicKey) -> Result<(), SshError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_serialize_with_code_discriminant() {
        let err = SshError::UnknownHostKey {
            host: "qb2".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:abc".into(),
            public_key: "ssh-ed25519 AAAA".into(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "unknown_host_key");
        assert_eq!(json["fingerprint"], "SHA256:abc");

        let json = serde_json::to_value(SshError::Refused {
            message: "x".into(),
        })
        .unwrap();
        assert_eq!(json["code"], "refused");
    }

    #[test]
    fn fatal_errors_are_the_non_retryable_ones() {
        assert!(SshError::AuthFailed {
            message: String::new()
        }
        .is_fatal());
        assert!(SshError::ChangedHostKey {
            host: String::new(),
            port: 22,
            fingerprint: String::new()
        }
        .is_fatal());
        assert!(!SshError::Refused {
            message: String::new()
        }
        .is_fatal());
        assert!(!SshError::Disconnected {
            message: String::new()
        }
        .is_fatal());
    }

    #[test]
    fn io_errors_classify_by_kind() {
        use std::io::{Error, ErrorKind};
        assert!(matches!(
            io_error(&Error::new(ErrorKind::ConnectionRefused, "no")),
            SshError::Refused { .. }
        ));
        assert!(matches!(
            io_error(&Error::new(ErrorKind::TimedOut, "slow")),
            SshError::Timeout { .. }
        ));
        assert!(matches!(
            io_error(&Error::new(ErrorKind::ConnectionReset, "rst")),
            SshError::Disconnected { .. }
        ));
    }
}
