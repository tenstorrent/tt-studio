// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

use tauri::{Manager, Url, WebviewWindow};

/// Navigate the launcher window to a running TT-Studio stack.
///
/// The stack URL must be plain http(s) on localhost/127.0.0.1 — the desktop
/// shell only fronts a locally running TT-Studio, never an arbitrary page.
/// Navigation replaces the bundled launcher in the same window; the remote
/// origin gets no Tauri IPC (see capabilities/default.json).
///
/// Side effect: this is the app's one definition of "we attached to a
/// stack", so it also stamps the last-session record (session.rs) that the
/// next launch resumes from. Both the already-healthy and the
/// just-brought-up paths funnel through here, so there is nothing to forget.
#[tauri::command]
pub fn open_stack(window: WebviewWindow, url: String) -> Result<(), String> {
    let target = validate_stack_url(&url)?;
    crate::session::record_attach(&window.app_handle().clone());
    window.navigate(target).map_err(|e| e.to_string())
}

fn validate_stack_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("unsupported scheme: {}", parsed.scheme()));
    }
    match parsed.host_str() {
        Some("localhost") | Some("127.0.0.1") => Ok(parsed),
        Some(other) => Err(format!("host must be localhost or 127.0.0.1, got {other}")),
        None => Err("URL has no host".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_stack_url;

    #[test]
    fn accepts_local_http_urls() {
        for url in [
            "http://localhost:3000",
            "http://localhost:3000/some/path",
            "http://127.0.0.1:3000",
            "https://localhost:8443",
        ] {
            assert!(validate_stack_url(url).is_ok(), "{url} should be allowed");
        }
    }

    #[test]
    fn rejects_non_local_hosts() {
        for url in [
            "http://example.com",
            "http://localhost.evil.com:3000",
            "http://192.168.1.10:3000",
            "http://[::1]:3000",
        ] {
            assert!(validate_stack_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn rejects_non_http_schemes() {
        for url in ["file:///etc/passwd", "ftp://localhost", "tauri://localhost"] {
            assert!(validate_stack_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn rejects_garbage() {
        assert!(validate_stack_url("not a url").is_err());
        assert!(validate_stack_url("").is_err());
    }
}

/// The OS Model Terms the launcher's first-run gate asks about.
pub const TERMS_URL: &str = "https://docs.tenstorrent.com/os-model-terms.html";

/// Open the terms in the user's browser. Takes no argument on purpose: the
/// URL is fixed, so the webview cannot turn this into an open-anything.
#[tauri::command]
pub fn open_terms(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(TERMS_URL, None::<&str>)
        .map_err(|e| e.to_string())
}
