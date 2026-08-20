// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Stack health poller.
//!
//! Read-only GETs against the TT-Studio services' health endpoints. The
//! launcher gates "open the stack" on the overall result: `ready` is true
//! only when every service reports healthy. A background poller pushes each
//! snapshot to the UI as a `stack-health` Tauri event.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

pub const HEALTH_EVENT: &str = "stack-health";
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    /// Responded 2xx.
    Up,
    /// Responded, but not 2xx.
    Down,
    /// No response at all (connection refused, timeout, DNS).
    Unreachable,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct ServiceHealth {
    pub name: String,
    pub url: String,
    pub status: ServiceStatus,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct StackHealth {
    pub services: Vec<ServiceHealth>,
    pub ready: bool,
}

/// Health-check URLs, injectable so tests can point them at a stub server.
#[derive(Clone, Debug)]
pub struct Endpoints {
    pub frontend: String,
    pub backend_up: String,
    pub backend_models: String,
    pub inference: String,
    pub docker_control: String,
}

impl Endpoints {
    pub fn local_default() -> Self {
        Self {
            frontend: "http://localhost:3000/".into(),
            backend_up: "http://localhost:8000/up/".into(),
            backend_models: "http://localhost:8000/models/health/".into(),
            inference: "http://localhost:8001/health".into(),
            docker_control: "http://localhost:8002/api/v1/health".into(),
        }
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("reqwest client construction cannot fail with static config")
}

async fn check(client: &reqwest::Client, name: &str, url: &str) -> ServiceHealth {
    let status = match client.get(url).send().await {
        Ok(resp) if resp.status().is_success() => ServiceStatus::Up,
        Ok(_) => ServiceStatus::Down,
        Err(_) => ServiceStatus::Unreachable,
    };
    ServiceHealth {
        name: name.to_string(),
        url: url.to_string(),
        status,
    }
}

pub async fn poll_once(client: &reqwest::Client, eps: &Endpoints) -> StackHealth {
    let (frontend, backend, models, inference, docker_control) = tokio::join!(
        check(client, "frontend", &eps.frontend),
        check(client, "backend", &eps.backend_up),
        check(client, "backend models", &eps.backend_models),
        check(client, "inference server", &eps.inference),
        check(client, "docker control", &eps.docker_control),
    );
    let services = vec![frontend, backend, models, inference, docker_control];
    let ready = services.iter().all(|s| s.status == ServiceStatus::Up);
    StackHealth { services, ready }
}

/// Managed state guarding against a second concurrent poll loop.
#[derive(Default)]
pub struct PollerState {
    running: Arc<AtomicBool>,
}

#[tauri::command]
pub async fn check_stack_health() -> StackHealth {
    poll_once(&client(), &Endpoints::local_default()).await
}

/// Start the background poller (idempotent). Emits a `stack-health` event
/// every couple of seconds until `stop_health_poll`.
#[tauri::command]
pub fn start_health_poll(
    app: tauri::AppHandle,
    state: tauri::State<'_, PollerState>,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Ok(()); // already polling
    }
    let running = state.running.clone();
    tauri::async_runtime::spawn(async move {
        let client = client();
        let eps = Endpoints::local_default();
        while running.load(Ordering::SeqCst) {
            let health = poll_once(&client, &eps).await;
            if app.emit(HEALTH_EVENT, &health).is_err() {
                break; // app is shutting down
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
    Ok(())
}

#[tauri::command]
pub fn stop_health_poll(state: tauri::State<'_, PollerState>) {
    state.running.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Minimal stub HTTP server: responds to each path with a fixed status
    /// code. The accept thread lives until the test binary exits.
    fn stub_server(routes: HashMap<&'static str, u16>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let code = routes.get(path.as_str()).copied().unwrap_or(404);
                let response =
                    format!("HTTP/1.1 {code} X\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    fn endpoints_for(base: &str) -> Endpoints {
        Endpoints {
            frontend: format!("{base}/"),
            backend_up: format!("{base}/up/"),
            backend_models: format!("{base}/models/health/"),
            inference: format!("{base}/health"),
            docker_control: format!("{base}/api/v1/health"),
        }
    }

    fn all_ok_routes() -> HashMap<&'static str, u16> {
        HashMap::from([
            ("/", 200),
            ("/up/", 200),
            ("/models/health/", 200),
            ("/health", 200),
            ("/api/v1/health", 200),
        ])
    }

    #[tokio::test]
    async fn ready_when_every_service_is_up() {
        let base = stub_server(all_ok_routes());
        let health = poll_once(&client(), &endpoints_for(&base)).await;
        assert!(health.ready);
        assert_eq!(health.services.len(), 5);
        assert!(health
            .services
            .iter()
            .all(|s| s.status == ServiceStatus::Up));
    }

    #[tokio::test]
    async fn one_failing_service_blocks_ready() {
        let mut routes = all_ok_routes();
        routes.insert("/health", 503); // inference server unhappy
        let base = stub_server(routes);
        let health = poll_once(&client(), &endpoints_for(&base)).await;
        assert!(!health.ready);
        let inference = health
            .services
            .iter()
            .find(|s| s.name == "inference server")
            .unwrap();
        assert_eq!(inference.status, ServiceStatus::Down);
        // The others still report up — the UI shows per-service detail.
        assert_eq!(
            health
                .services
                .iter()
                .filter(|s| s.status == ServiceStatus::Up)
                .count(),
            4
        );
    }

    #[tokio::test]
    async fn unreachable_stack_reports_unreachable_not_down() {
        // Bind-then-drop guarantees nothing is listening on the port.
        let addr = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap()
        };
        let health = poll_once(&client(), &endpoints_for(&format!("http://{addr}"))).await;
        assert!(!health.ready);
        assert!(health
            .services
            .iter()
            .all(|s| s.status == ServiceStatus::Unreachable));
    }

    /// Opt-in check against a locally running stack (read-only GETs):
    /// `cargo test -- --ignored live_stack`.
    #[tokio::test]
    #[ignore = "needs a running TT-Studio stack on localhost"]
    async fn live_stack_poll() {
        let health = poll_once(&client(), &Endpoints::local_default()).await;
        for s in &health.services {
            println!("{:<18} {} -> {:?}", s.name, s.url, s.status);
        }
        println!("ready: {}", health.ready);
    }

    #[test]
    fn health_serializes_for_the_ui() {
        let health = StackHealth {
            services: vec![ServiceHealth {
                name: "frontend".into(),
                url: "http://localhost:3000/".into(),
                status: ServiceStatus::Up,
            }],
            ready: false,
        };
        let json = serde_json::to_value(&health).unwrap();
        assert_eq!(json["services"][0]["status"], "up");
        assert_eq!(json["ready"], false);
    }
}
