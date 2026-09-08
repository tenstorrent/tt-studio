// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Dynamic tunnel forwards for marketplace app ports.
//!
//! Marketplace apps (AppsPage.tsx → `/models-api/marketplace/apps/`) run in
//! containers whose host ports the backend allocates at launch time from its
//! own range (shared_config/marketplace_config.py) — no static forward list
//! can cover them. While an SSH tunnel is connected, this poller asks the
//! backend (a read-only GET through the already-forwarded port 8000) which
//! apps hold a host port right now, and reconciles the supervisor's dynamic
//! forwards to exactly that set: launched apps become reachable through the
//! tunnel within one poll, stopped apps free their local listeners.

use std::time::Duration;

use super::tunnel::{ForwardSpec, TunnelPhase};

/// The backend's marketplace listing, through the tunneled backend port.
pub const MARKETPLACE_URL: &str = "http://localhost:8000/models/marketplace/apps/";

pub const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// App statuses that hold (or are about to hold) a live host port.
const ACTIVE_STATUSES: [&str; 3] = ["pulling", "starting", "running"];

/// Extract the host ports to forward from a marketplace listing. Ports in
/// `exclude` (the static production forwards) are skipped; the result is
/// sorted and deduplicated so callers can compare sets cheaply.
pub fn desired_app_ports(payload: &str, exclude: &[u16]) -> Vec<u16> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return Vec::new();
    };
    let Some(apps) = value["apps"].as_array() else {
        return Vec::new();
    };
    let mut ports: Vec<u16> = apps
        .iter()
        .filter(|app| {
            app["status"]
                .as_str()
                .map(|s| ACTIVE_STATUSES.contains(&s))
                .unwrap_or(false)
        })
        .filter_map(|app| app["host_port"].as_u64())
        .filter_map(|p| u16::try_from(p).ok())
        .filter(|p| !exclude.contains(p))
        .collect();
    ports.sort_unstable();
    ports.dedup();
    ports
}

pub fn forwards_for(ports: &[u16]) -> Vec<ForwardSpec> {
    ports
        .iter()
        .map(|&port| ForwardSpec {
            local_port: port,
            remote_host: "127.0.0.1".into(),
            remote_port: port,
        })
        .collect()
}

/// Poll loop: runs until aborted (see TunnelState). Only talks to the
/// backend while the supervisor reports Connected — before that, port 8000
/// might be some unrelated local server.
pub(crate) async fn sync_loop(app: tauri::AppHandle) {
    use tauri::Manager;
    let client = crate::health::client();
    let static_ports: Vec<u16> = super::tunnel::production_forwards()
        .iter()
        .map(|f| f.local_port)
        .collect();
    let mut last: Option<Vec<u16>> = None;

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        let state = app.state::<super::commands::TunnelState>();

        let connected = {
            let guard = state.supervisor.lock().await;
            match guard.as_ref() {
                Some(sup) => matches!(sup.status().phase, TunnelPhase::Connected),
                None => return, // tunnels are gone; so is this loop's job
            }
        };
        if !connected {
            continue;
        }

        let Ok(response) = client.get(MARKETPLACE_URL).send().await else {
            continue; // backend not answering yet; try again next tick
        };
        let Ok(payload) = response.text().await else {
            continue;
        };
        let ports = desired_app_ports(&payload, &static_ports);
        if last.as_ref() == Some(&ports) {
            continue;
        }

        let guard = state.supervisor.lock().await;
        if let Some(sup) = guard.as_ref() {
            sup.set_dynamic_forwards(forwards_for(&ports));
            last = Some(ports);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing(apps: &[(&str, Option<u64>)]) -> String {
        let apps: Vec<serde_json::Value> = apps
            .iter()
            .map(|(status, port)| {
                let mut app = serde_json::json!({ "id": "x", "status": status });
                if let Some(port) = port {
                    app["host_port"] = serde_json::json!(port);
                }
                app
            })
            .collect();
        serde_json::json!({ "gateway_configured": true, "apps": apps }).to_string()
    }

    #[test]
    fn active_apps_with_ports_are_forwarded() {
        let payload = listing(&[
            ("running", Some(3085)),
            ("starting", Some(3086)),
            ("pulling", Some(3087)),
            ("stopped", Some(3088)), // inactive: no forward
            ("running", None),       // no port yet
            ("guide", None),
            ("error", Some(3089)), // failed: port is being released
        ]);
        assert_eq!(desired_app_ports(&payload, &[]), vec![3085, 3086, 3087]);
    }

    #[test]
    fn static_ports_and_duplicates_are_dropped() {
        let payload = listing(&[
            ("running", Some(8000)), // already a production forward
            ("running", Some(3085)),
            ("starting", Some(3085)), // duplicate
        ]);
        assert_eq!(desired_app_ports(&payload, &[8000]), vec![3085]);
    }

    #[test]
    fn garbage_payloads_forward_nothing() {
        assert!(desired_app_ports("not json", &[]).is_empty());
        assert!(desired_app_ports("{}", &[]).is_empty());
        assert!(desired_app_ports(r#"{"apps": 3}"#, &[]).is_empty());
        // Out-of-range port numbers are ignored, not truncated.
        let payload = listing(&[("running", Some(70000))]);
        assert!(desired_app_ports(&payload, &[]).is_empty());
    }

    #[test]
    fn forwards_map_ports_one_to_one() {
        let forwards = forwards_for(&[3085, 3086]);
        assert_eq!(forwards.len(), 2);
        assert!(forwards
            .iter()
            .all(|f| f.local_port == f.remote_port && f.remote_host == "127.0.0.1"));
    }
}
