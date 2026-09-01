// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Local port-forward supervisor.
//!
//! Owns one [`SshTransport`] session and a set of local TCP listeners; every
//! accepted connection becomes a direct-tcpip channel to the same port on
//! the remote machine. The supervisor task watches session liveness and
//! redials with exponential backoff (1 s doubling to a 30 s cap). Local
//! listeners bind the SAME port numbers as the remote services because the
//! web app derives its URLs from `window.location.hostname` + fixed ports.

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use super::{SshError, SshTransport};
use crate::port_holder::{listener_on, PortHolder};

/// One local listener → remote endpoint mapping. `local_port` 0 lets the OS
/// pick (tests only); the bound port is reported back via [`ForwardHealth`].
#[derive(Clone, Debug)]
pub struct ForwardSpec {
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// The TT-Studio stack's fixed port map: frontend 3000, backend 8000,
/// inference 8001, docker control 8002, agent 8080, ChromaDB 8111, 4000.
/// Same numbers locally and remotely. Marketplace app containers get their
/// host ports dynamically from the backend (see ssh/app_ports.rs) and are
/// added as dynamic forwards at runtime — the backend allocates them from
/// its own range, so no static range here can cover them.
pub fn production_forwards() -> Vec<ForwardSpec> {
    [3000u16, 8000, 8001, 8002, 8080, 8111, 4000]
        .into_iter()
        .map(|port| ForwardSpec {
            local_port: port,
            remote_host: "127.0.0.1".into(),
            remote_port: port,
        })
        .collect()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum TunnelPhase {
    /// First dial for this supervisor.
    Connecting,
    /// Session up, listeners bound.
    Connected,
    /// Session died or dial failed; the supervisor will retry.
    Reconnecting { attempt: u32, next_delay_secs: u64 },
    /// Gave up: fatal error or retries exhausted. Terminal.
    Lost { error: SshError },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ForwardHealth {
    /// Actual bound local port (resolves a 0 in the spec).
    pub local_port: u16,
    pub remote_port: u16,
    /// The listener is bound and accepting.
    pub active: bool,
    /// Most recent per-connection failure, if any.
    pub last_error: Option<String>,
    /// Process squatting on `local_port`, when the bind failed because
    /// something else already holds it.
    pub holder: Option<PortHolder>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TunnelStatus {
    pub phase: TunnelPhase,
    pub forwards: Vec<ForwardHealth>,
}

/// Dials one fresh authenticated session. Injected so tests can hand back
/// fake transports and the Tauri layer can capture profile + verifier.
pub type Connector = Arc<
    dyn Fn() -> Pin<Box<dyn Future<Output = Result<Arc<dyn SshTransport>, SshError>> + Send>>
        + Send
        + Sync,
>;

/// Receives every status change (the Tauri layer turns these into events).
pub type StatusSink = Arc<dyn Fn(TunnelStatus) + Send + Sync>;

#[derive(Clone, Debug)]
pub struct SupervisorConfig {
    pub forwards: Vec<ForwardSpec>,
    pub bind_addr: IpAddr,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    /// Consecutive failed dials tolerated before giving up.
    pub max_attempts: u32,
}

impl Default for SupervisorConfig {
    fn default() -> Self {
        Self {
            forwards: production_forwards(),
            bind_addr: IpAddr::V4(Ipv4Addr::LOCALHOST),
            initial_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(30),
            max_attempts: 8,
        }
    }
}

/// How often the supervisor polls [`SshTransport::is_closed`]. Keepalives in
/// the session make a dead link flip this within ~30 s worst case.
const LIVENESS_POLL: Duration = Duration::from_millis(500);

pub struct Supervisor {
    status: Arc<Mutex<TunnelStatus>>,
    shutdown: watch::Sender<bool>,
    dynamic: tokio::sync::mpsc::UnboundedSender<Vec<ForwardSpec>>,
    task: JoinHandle<()>,
}

impl Supervisor {
    pub fn spawn(config: SupervisorConfig, connector: Connector, sink: StatusSink) -> Self {
        let status = Arc::new(Mutex::new(TunnelStatus {
            phase: TunnelPhase::Connecting,
            forwards: Vec::new(),
        }));
        let (shutdown, shutdown_rx) = watch::channel(false);
        let (dynamic, dynamic_rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(
            config,
            connector,
            sink,
            status.clone(),
            shutdown_rx,
            dynamic_rx,
        ));
        Self {
            status,
            shutdown,
            dynamic,
            task,
        }
    }

    pub fn status(&self) -> TunnelStatus {
        self.status.lock().expect("status lock").clone()
    }

    /// Replace the set of dynamic forwards (marketplace app ports). Applied
    /// while connected: new ports get listeners on the live session, dropped
    /// ports lose theirs; the whole set is re-bound after a reconnect. The
    /// static production forwards are never touched.
    pub fn set_dynamic_forwards(&self, specs: Vec<ForwardSpec>) {
        let _ = self.dynamic.send(specs);
    }

    /// Clean shutdown: closes the session and stops all listeners without
    /// emitting a `lost` status.
    pub async fn stop(self) {
        let _ = self.shutdown.send(true);
        let _ = self.task.await;
    }
}

fn publish(
    status: &Arc<Mutex<TunnelStatus>>,
    sink: &StatusSink,
    update: impl FnOnce(&mut TunnelStatus),
) {
    let snapshot = {
        let mut guard = status.lock().expect("status lock");
        update(&mut guard);
        guard.clone()
    };
    sink(snapshot);
}

/// Bind one forward on the current transport: a health row plus the accept
/// task when the bind succeeded.
async fn bind_forward(
    bind_addr: IpAddr,
    spec: &ForwardSpec,
    transport: &Arc<dyn SshTransport>,
    status: &Arc<Mutex<TunnelStatus>>,
    sink: &StatusSink,
) -> (ForwardHealth, Option<JoinHandle<()>>) {
    match TcpListener::bind((bind_addr, spec.local_port)).await {
        Ok(listener) => {
            let bound = listener
                .local_addr()
                .map(|a| a.port())
                .unwrap_or(spec.local_port);
            let task = tokio::spawn(accept_loop(
                listener,
                spec.clone(),
                transport.clone(),
                status.clone(),
                sink.clone(),
                bound,
            ));
            (
                ForwardHealth {
                    local_port: bound,
                    remote_port: spec.remote_port,
                    active: true,
                    last_error: None,
                    holder: None,
                },
                Some(task),
            )
        }
        Err(e) => {
            // Only an in-use port has a holder worth naming, and the probe
            // shells out, so keep it off the accept path's runtime thread.
            let holder = if e.kind() == std::io::ErrorKind::AddrInUse {
                let port = spec.local_port;
                tokio::task::spawn_blocking(move || listener_on(port))
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };
            (
                ForwardHealth {
                    local_port: spec.local_port,
                    remote_port: spec.remote_port,
                    active: false,
                    last_error: Some(format!("bind 127.0.0.1:{}: {e}", spec.local_port)),
                    holder,
                },
                None,
            )
        }
    }
}

async fn run(
    config: SupervisorConfig,
    connector: Connector,
    sink: StatusSink,
    status: Arc<Mutex<TunnelStatus>>,
    mut shutdown: watch::Receiver<bool>,
    mut dynamic_rx: tokio::sync::mpsc::UnboundedReceiver<Vec<ForwardSpec>>,
) {
    let mut attempt: u32 = 0;
    let mut delay = config.initial_backoff;
    // The current dynamic forward set; survives reconnects.
    let mut dynamic: Vec<ForwardSpec> = Vec::new();

    loop {
        if *shutdown.borrow() {
            return;
        }
        if attempt == 0 {
            publish(&status, &sink, |s| {
                s.phase = TunnelPhase::Connecting;
                s.forwards.clear();
            });
        }

        let transport = tokio::select! {
            _ = shutdown.changed() => return,
            result = connector() => match result {
                Ok(t) => t,
                Err(e) => {
                    if e.is_fatal() || attempt >= config.max_attempts {
                        publish(&status, &sink, |s| {
                            s.phase = TunnelPhase::Lost { error: e };
                            s.forwards.clear();
                        });
                        return;
                    }
                    attempt += 1;
                    publish(&status, &sink, |s| {
                        s.phase = TunnelPhase::Reconnecting {
                            attempt,
                            next_delay_secs: delay.as_secs(),
                        };
                    });
                    tokio::select! {
                        _ = shutdown.changed() => return,
                        _ = tokio::time::sleep(delay) => {}
                    }
                    delay = (delay * 2).min(config.max_backoff);
                    continue;
                }
            },
        };

        // Session is up: bind every static listener and start accept loops.
        let mut accept_tasks: Vec<JoinHandle<()>> = Vec::new();
        let mut healths: Vec<ForwardHealth> = Vec::new();
        let mut bind_failure: Option<String> = None;
        for spec in &config.forwards {
            let (health, task) =
                bind_forward(config.bind_addr, spec, &transport, &status, &sink).await;
            if let Some(err) = &health.last_error {
                bind_failure.get_or_insert(err.clone());
            }
            accept_tasks.extend(task);
            healths.push(health);
        }

        if healths.iter().all(|h| !h.active) {
            // Nothing usable was bound (ports taken) — retrying won't fix it.
            for t in &accept_tasks {
                t.abort();
            }
            transport.close().await;
            publish(&status, &sink, |s| {
                s.phase = TunnelPhase::Lost {
                    error: SshError::Internal {
                        message: bind_failure
                            .unwrap_or_else(|| "no forward could bind locally".into()),
                    },
                };
                s.forwards = healths;
            });
            return;
        }

        // Re-bind the dynamic set from previous epochs on the new session.
        let mut dyn_tasks: std::collections::HashMap<u16, JoinHandle<()>> =
            std::collections::HashMap::new();
        for spec in dynamic.clone() {
            let (health, task) =
                bind_forward(config.bind_addr, &spec, &transport, &status, &sink).await;
            if let Some(task) = task {
                // Keyed by the actually-bound port (resolves a 0 in the spec).
                dyn_tasks.insert(health.local_port, task);
            }
            healths.push(health);
        }

        delay = config.initial_backoff;
        publish(&status, &sink, |s| {
            s.phase = TunnelPhase::Connected;
            s.forwards = healths;
        });

        // Watch the session until it dies or we're told to stop, applying
        // dynamic forward updates as they arrive.
        let session_died = loop {
            tokio::select! {
                _ = shutdown.changed() => break false,
                specs = dynamic_rx.recv() => {
                    let Some(specs) = specs else { break false };
                    // Drop forwards that fell out of the set…
                    let keep: std::collections::HashSet<u16> =
                        specs.iter().map(|s| s.local_port).collect();
                    let dropped: Vec<u16> = dyn_tasks
                        .keys()
                        .filter(|p| !keep.contains(p))
                        .copied()
                        .collect();
                    for port in dropped {
                        if let Some(task) = dyn_tasks.remove(&port) {
                            task.abort();
                        }
                        publish(&status, &sink, |s| {
                            s.forwards.retain(|h| h.local_port != port);
                        });
                    }
                    // …and bind the new ones on the live session. Port 0
                    // (OS-assigned, tests only) can't collide, so it skips
                    // the already-bound checks.
                    for spec in &specs {
                        if spec.local_port != 0
                            && (dyn_tasks.contains_key(&spec.local_port)
                                || config.forwards.iter().any(|f| f.local_port == spec.local_port))
                        {
                            continue;
                        }
                        let (health, task) =
                            bind_forward(config.bind_addr, spec, &transport, &status, &sink).await;
                        if let Some(task) = task {
                            dyn_tasks.insert(health.local_port, task);
                        }
                        publish(&status, &sink, |s| {
                            s.forwards.retain(|h| h.local_port != health.local_port);
                            s.forwards.push(health.clone());
                        });
                    }
                    dynamic = specs;
                }
                _ = tokio::time::sleep(LIVENESS_POLL) => {
                    if transport.is_closed() {
                        break true;
                    }
                }
            }
        };

        for t in &accept_tasks {
            t.abort();
        }
        for task in dyn_tasks.values() {
            task.abort();
        }
        transport.close().await;

        if !session_died {
            return; // clean shutdown, no status change
        }
        attempt = 1;
        publish(&status, &sink, |s| {
            s.phase = TunnelPhase::Reconnecting {
                attempt,
                next_delay_secs: delay.as_secs(),
            };
            s.forwards.clear();
        });
        tokio::select! {
            _ = shutdown.changed() => return,
            _ = tokio::time::sleep(delay) => {}
        }
        delay = (delay * 2).min(config.max_backoff);
    }
}

async fn accept_loop(
    listener: TcpListener,
    spec: ForwardSpec,
    transport: Arc<dyn SshTransport>,
    status: Arc<Mutex<TunnelStatus>>,
    sink: StatusSink,
    bound_port: u16,
) {
    loop {
        let mut sock = match listener.accept().await {
            Ok((sock, _)) => sock,
            Err(_) => {
                // Transient accept failure (fd pressure etc.); don't spin.
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let transport = transport.clone();
        let spec = spec.clone();
        let status = status.clone();
        let sink = sink.clone();
        tokio::spawn(async move {
            match transport
                .open_forward(&spec.remote_host, spec.remote_port)
                .await
            {
                Ok(mut stream) => {
                    let _ = tokio::io::copy_bidirectional(&mut sock, &mut stream).await;
                }
                Err(e) => {
                    // Forwards come and go dynamically, so rows are keyed by
                    // their bound local port, never by position.
                    publish(&status, &sink, |s| {
                        if let Some(h) = s.forwards.iter_mut().find(|h| h.local_port == bound_port)
                        {
                            h.last_error = Some(e.to_string());
                        }
                    });
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc;

    /// Transport whose forwards are plain TCP connections to a local echo
    /// server, with liveness controlled by a flag.
    struct FakeTransport {
        echo_addr: std::net::SocketAddr,
        closed: Arc<AtomicBool>,
    }

    #[async_trait::async_trait]
    impl SshTransport for FakeTransport {
        async fn open_forward(
            &self,
            _host: &str,
            _port: u16,
        ) -> Result<Box<dyn super::super::ForwardStream>, SshError> {
            let stream = tokio::net::TcpStream::connect(self.echo_addr)
                .await
                .map_err(|e| super::super::io_error(&e))?;
            Ok(Box::new(stream))
        }

        fn is_closed(&self) -> bool {
            self.closed.load(Ordering::SeqCst)
        }

        async fn close(&self) {
            self.closed.store(true, Ordering::SeqCst);
        }
    }

    async fn echo_server() -> std::net::SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    while let Ok(n) = sock.read(&mut buf).await {
                        if n == 0 || sock.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });
        addr
    }

    fn test_config() -> SupervisorConfig {
        SupervisorConfig {
            // High random port: bind 0 and read the real port from status.
            forwards: vec![ForwardSpec {
                local_port: 0,
                remote_host: "127.0.0.1".into(),
                remote_port: 9999,
            }],
            initial_backoff: Duration::from_millis(10),
            max_backoff: Duration::from_millis(40),
            max_attempts: 2,
            ..Default::default()
        }
    }

    fn channel_sink() -> (StatusSink, mpsc::UnboundedReceiver<TunnelStatus>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let sink: StatusSink = Arc::new(move |s| {
            let _ = tx.send(s);
        });
        (sink, rx)
    }

    async fn wait_for(
        rx: &mut mpsc::UnboundedReceiver<TunnelStatus>,
        pred: impl Fn(&TunnelStatus) -> bool,
    ) -> TunnelStatus {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let status = rx.recv().await.expect("status stream ended");
                if pred(&status) {
                    return status;
                }
            }
        })
        .await
        .expect("timed out waiting for status")
    }

    fn connector_to(
        echo_addr: std::net::SocketAddr,
        dials: Arc<AtomicU32>,
        closed_flags: Arc<Mutex<Vec<Arc<AtomicBool>>>>,
    ) -> Connector {
        Arc::new(move || {
            dials.fetch_add(1, Ordering::SeqCst);
            let closed = Arc::new(AtomicBool::new(false));
            closed_flags.lock().unwrap().push(closed.clone());
            let transport: Arc<dyn SshTransport> = Arc::new(FakeTransport { echo_addr, closed });
            Box::pin(async move { Ok(transport) })
        })
    }

    #[tokio::test]
    async fn forwards_round_trip_through_the_tunnel() {
        let echo = echo_server().await;
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let flags = Arc::new(Mutex::new(Vec::new()));
        let sup = Supervisor::spawn(test_config(), connector_to(echo, dials, flags), sink);

        let connected = wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Connected)).await;
        let port = connected.forwards[0].local_port;
        assert_ne!(port, 0, "bound port must be reported");

        let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        sock.write_all(b"ping").await.unwrap();
        let mut buf = [0u8; 4];
        sock.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"ping");

        sup.stop().await;
    }

    #[tokio::test]
    async fn session_death_triggers_reconnect_with_fresh_transport() {
        let echo = echo_server().await;
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let flags: Arc<Mutex<Vec<Arc<AtomicBool>>>> = Arc::new(Mutex::new(Vec::new()));
        let sup = Supervisor::spawn(
            test_config(),
            connector_to(echo, dials.clone(), flags.clone()),
            sink,
        );

        wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Connected)).await;
        // Kill the first session out from under the supervisor.
        flags.lock().unwrap()[0].store(true, Ordering::SeqCst);

        wait_for(&mut rx, |s| {
            matches!(s.phase, TunnelPhase::Reconnecting { attempt: 1, .. })
        })
        .await;
        let reconnected = wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Connected)).await;
        assert_eq!(dials.load(Ordering::SeqCst), 2);

        // The rebuilt tunnel still round-trips.
        let port = reconnected.forwards[0].local_port;
        let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        sock.write_all(b"again").await.unwrap();
        let mut buf = [0u8; 5];
        sock.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"again");

        sup.stop().await;
    }

    #[tokio::test]
    async fn fatal_connect_error_stops_without_retries() {
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let dials_in = dials.clone();
        let connector: Connector = Arc::new(move || {
            dials_in.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Err(SshError::AuthFailed {
                    message: "bad key".into(),
                })
            })
        });
        let sup = Supervisor::spawn(test_config(), connector, sink);

        let lost = wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Lost { .. })).await;
        assert!(matches!(
            lost.phase,
            TunnelPhase::Lost {
                error: SshError::AuthFailed { .. }
            }
        ));
        assert_eq!(
            dials.load(Ordering::SeqCst),
            1,
            "fatal errors must not retry"
        );
        sup.stop().await;
    }

    #[tokio::test]
    async fn retryable_errors_back_off_then_give_up() {
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let dials_in = dials.clone();
        let connector: Connector = Arc::new(move || {
            dials_in.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Err(SshError::Refused {
                    message: "nobody home".into(),
                })
            })
        });
        let sup = Supervisor::spawn(test_config(), connector, sink);

        wait_for(&mut rx, |s| {
            matches!(s.phase, TunnelPhase::Reconnecting { attempt: 1, .. })
        })
        .await;
        wait_for(&mut rx, |s| {
            matches!(s.phase, TunnelPhase::Reconnecting { attempt: 2, .. })
        })
        .await;
        wait_for(&mut rx, |s| {
            matches!(
                s.phase,
                TunnelPhase::Lost {
                    error: SshError::Refused { .. }
                }
            )
        })
        .await;
        // max_attempts=2 → initial dial + 2 retries.
        assert_eq!(dials.load(Ordering::SeqCst), 3);
        sup.stop().await;
    }

    #[tokio::test]
    async fn clean_stop_emits_no_lost_status() {
        let echo = echo_server().await;
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let flags = Arc::new(Mutex::new(Vec::new()));
        let sup = Supervisor::spawn(
            test_config(),
            connector_to(echo, dials, flags.clone()),
            sink,
        );
        wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Connected)).await;
        sup.stop().await;
        // The transport was closed and no further status arrived.
        assert!(flags.lock().unwrap()[0].load(Ordering::SeqCst));
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn production_map_covers_the_stack_ports() {
        let forwards = production_forwards();
        let ports: Vec<u16> = forwards.iter().map(|f| f.local_port).collect();
        for expected in [3000, 8000, 8001, 8002, 8080, 8111, 4000] {
            assert!(ports.contains(&expected), "missing port {expected}");
        }
        // Marketplace app ports are dynamic (ssh/app_ports.rs), not static.
        assert_eq!(forwards.len(), 7);
        // Local and remote port numbers must match — the web app derives its
        // URLs from window.location.hostname plus these fixed ports.
        assert!(forwards.iter().all(|f| f.local_port == f.remote_port));
    }

    async fn connect_ok(sock: &mut tokio::net::TcpStream, payload: &[u8]) {
        sock.write_all(payload).await.unwrap();
        let mut buf = vec![0u8; payload.len()];
        sock.read_exact(&mut buf).await.unwrap();
        assert_eq!(buf, payload);
    }

    #[tokio::test]
    async fn dynamic_forwards_bind_and_unbind_while_connected() {
        let echo = echo_server().await;
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let flags = Arc::new(Mutex::new(Vec::new()));
        let sup = Supervisor::spawn(test_config(), connector_to(echo, dials, flags), sink);
        wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Connected)).await;

        // Add one dynamic app port (0 = OS-assigned for the test).
        sup.set_dynamic_forwards(vec![ForwardSpec {
            local_port: 0,
            remote_host: "127.0.0.1".into(),
            remote_port: 3085,
        }]);
        let status = wait_for(&mut rx, |s| {
            s.forwards.iter().any(|f| f.remote_port == 3085 && f.active)
        })
        .await;
        assert_eq!(status.forwards.len(), 2);
        let port = status
            .forwards
            .iter()
            .find(|f| f.remote_port == 3085)
            .unwrap()
            .local_port;

        // Traffic flows through the dynamic forward.
        let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        connect_ok(&mut sock, b"app").await;

        // Empty set removes it; the static forward stays.
        sup.set_dynamic_forwards(Vec::new());
        let status = wait_for(&mut rx, |s| s.forwards.len() == 1).await;
        assert_eq!(status.forwards[0].remote_port, 9999);
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err(),
            "dynamic listener should be gone"
        );

        sup.stop().await;
    }

    #[tokio::test]
    async fn dynamic_forwards_survive_a_reconnect() {
        let echo = echo_server().await;
        let (sink, mut rx) = channel_sink();
        let dials = Arc::new(AtomicU32::new(0));
        let flags: Arc<Mutex<Vec<Arc<AtomicBool>>>> = Arc::new(Mutex::new(Vec::new()));
        let sup = Supervisor::spawn(
            test_config(),
            connector_to(echo, dials, flags.clone()),
            sink,
        );
        wait_for(&mut rx, |s| matches!(s.phase, TunnelPhase::Connected)).await;

        // Bind a real high port so the re-bind after reconnect is observable.
        let free_port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        sup.set_dynamic_forwards(vec![ForwardSpec {
            local_port: free_port,
            remote_host: "127.0.0.1".into(),
            remote_port: 3085,
        }]);
        wait_for(&mut rx, |s| {
            s.forwards
                .iter()
                .any(|f| f.local_port == free_port && f.active)
        })
        .await;

        // Kill the session; after the reconnect the dynamic port is back.
        flags.lock().unwrap()[0].store(true, Ordering::SeqCst);
        let reconnected = wait_for(&mut rx, |s| {
            matches!(s.phase, TunnelPhase::Connected)
                && s.forwards
                    .iter()
                    .any(|f| f.local_port == free_port && f.active)
        })
        .await;
        assert_eq!(reconnected.forwards.len(), 2);

        let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", free_port))
            .await
            .unwrap();
        connect_ok(&mut sock, b"back").await;

        sup.stop().await;
    }

    #[test]
    fn status_serializes_for_the_ui() {
        let status = TunnelStatus {
            phase: TunnelPhase::Reconnecting {
                attempt: 3,
                next_delay_secs: 4,
            },
            forwards: vec![ForwardHealth {
                local_port: 3000,
                remote_port: 3000,
                active: true,
                last_error: None,
                holder: None,
            }],
        };
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["phase"]["state"], "reconnecting");
        assert_eq!(json["phase"]["attempt"], 3);
        assert_eq!(json["forwards"][0]["local_port"], 3000);

        let lost = TunnelStatus {
            phase: TunnelPhase::Lost {
                error: SshError::ChangedHostKey {
                    host: "qb2".into(),
                    port: 22,
                    fingerprint: "SHA256:x".into(),
                },
            },
            forwards: vec![],
        };
        let json = serde_json::to_value(&lost).unwrap();
        assert_eq!(json["phase"]["state"], "lost");
        assert_eq!(json["phase"]["error"]["code"], "changed_host_key");
    }
}
