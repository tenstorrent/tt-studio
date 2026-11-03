// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Updater dry-run: a real `updater.check()` against a locally served
//! `latest.json` fixture — the same plugin code path the launch check and
//! the "Check for updates" button hit, minus the download/install step
//! (which needs a signed artifact from release CI).

use std::io::{Read, Write};
use std::net::TcpListener;
use tauri_plugin_updater::UpdaterExt;

/// One-shot HTTP server: serves `body` as JSON for a single request.
fn serve_once(body: String) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    port
}

fn fixture(version: &str, port: u16) -> String {
    format!(
        r#"{{
  "version": "{version}",
  "notes": "dry-run fixture",
  "pub_date": "2026-08-20T00:00:00Z",
  "platforms": {{
    "linux-x86_64": {{
      "signature": "Zml4dHVyZS1zaWduYXR1cmU=",
      "url": "http://127.0.0.1:{port}/tt-studio.AppImage.tar.gz"
    }},
    "darwin-x86_64": {{
      "signature": "Zml4dHVyZS1zaWduYXR1cmU=",
      "url": "http://127.0.0.1:{port}/tt-studio.app.tar.gz"
    }},
    "darwin-aarch64": {{
      "signature": "Zml4dHVyZS1zaWduYXR1cmU=",
      "url": "http://127.0.0.1:{port}/tt-studio.app.tar.gz"
    }},
    "windows-x86_64": {{
      "signature": "Zml4dHVyZS1zaWduYXR1cmU=",
      "url": "http://127.0.0.1:{port}/tt-studio.msi"
    }}
  }}
}}"#
    )
}

/// A mock app with the updater plugin configured like tauri.conf.json, but
/// pointed at the local fixture endpoint (http allowed for the test only).
fn mock_app(port: u16) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert(
        "updater".to_string(),
        serde_json::json!({
            // Any well-formed minisign pubkey works here: check() only
            // verifies signatures at download time, which this test stops
            // short of.
            "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEEzNjMwNTM2RTA4M0E1N0QKUldSOXBZUGdOZ1ZqbzJKb1F1c29GT3VySmpYUXlSUGoyWFg4V0g4UmFmUmhicGtVcHRMUi9ORmoK",
            "endpoints": [format!("http://127.0.0.1:{port}/latest.json")],
            "dangerousInsecureTransportProtocol": true
        }),
    );
    tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap()
}

#[test]
fn check_finds_a_newer_release_on_the_feed() {
    let port = serve_once(fixture("99.0.0", port_placeholder()));
    let app = mock_app(port);
    let updater = app.handle().updater().unwrap();
    let update = tauri::async_runtime::block_on(updater.check()).unwrap();
    let update = update.expect("99.0.0 > 0.1.0 must be an available update");
    assert_eq!(update.version, "99.0.0");
}

#[test]
fn check_reports_up_to_date_for_an_older_release() {
    let port = serve_once(fixture("0.0.1", port_placeholder()));
    let app = mock_app(port);
    let updater = app.handle().updater().unwrap();
    let update = tauri::async_runtime::block_on(updater.check()).unwrap();
    assert!(update.is_none(), "0.0.1 < 0.1.0 must not offer an update");
}

#[test]
fn check_errors_when_the_feed_is_unreachable() {
    // Bind-and-drop: nothing listens on this port anymore.
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let app = mock_app(port);
    let updater = app.handle().updater().unwrap();
    let result = tauri::async_runtime::block_on(updater.check());
    assert!(
        result.is_err(),
        "offline check must reject, not hang or lie"
    );
}

/// The artifact URL's port doesn't matter for check(); keep it obvious.
fn port_placeholder() -> u16 {
    9
}
