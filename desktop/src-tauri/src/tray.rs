// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! System tray: stack-status dot + quick actions.
//!
//! The tray mirrors the health poller: every `stack-health` event restamps
//! the tray icon with a colored dot (green = every service up, amber = some,
//! gray = none/unknown) and updates a disabled status row in the menu. The
//! actions are thin: they reuse the same paths the launcher UI drives —
//! showing the window, navigating back to the picker, `run.py --stop`
//! (local child or ssh exec), and the normal close-requested quit flow.
//!
//! On Linux this uses tauri's `tray-icon` feature (ayatana appindicator at
//! runtime); the health poller only runs while the launcher asks it to, so
//! the dot goes gray whenever nothing is polling.

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Listener, Manager, Wry};

pub const TRAY_ID: &str = "tt-studio-tray";

/// What the dot should say about the stack.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StackDot {
    /// Every service up.
    Ready,
    /// Some services answered, some didn't.
    Partial,
    /// Nothing up (or nothing known).
    Off,
}

impl StackDot {
    pub fn rgba(self) -> [u8; 4] {
        match self {
            StackDot::Ready => [34, 197, 94, 255],    // emerald-500
            StackDot::Partial => [245, 158, 11, 255], // amber-500
            StackDot::Off => [113, 113, 122, 255],    // zinc-500
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            StackDot::Ready => "Stack: running",
            StackDot::Partial => "Stack: partially up",
            StackDot::Off => "Stack: not running",
        }
    }
}

/// The slice of a `stack-health` payload the tray cares about.
#[derive(Deserialize)]
struct HealthSlice {
    ready: bool,
    services: Vec<ServiceSlice>,
}

#[derive(Deserialize)]
struct ServiceSlice {
    status: String,
}

/// Fold a `stack-health` event payload (JSON) into a dot state. Anything
/// unparseable reads as Off — the tray must never wedge on a bad payload.
pub fn dot_from_health(payload: &str) -> StackDot {
    let Ok(health) = serde_json::from_str::<HealthSlice>(payload) else {
        return StackDot::Off;
    };
    if health.ready {
        return StackDot::Ready;
    }
    if health.services.iter().any(|s| s.status == "up") {
        return StackDot::Partial;
    }
    StackDot::Off
}

/// Stamp a filled status dot into the bottom-right corner of an RGBA icon.
/// Pure pixel math so it's unit-testable without a display.
pub fn stamp_dot(rgba: &mut [u8], width: u32, height: u32, color: [u8; 4]) {
    let radius = (width.min(height) as i64 / 4).max(2);
    let cx = width as i64 - radius - 1;
    let cy = height as i64 - radius - 1;
    for y in (cy - radius).max(0)..(cy + radius + 1).min(height as i64) {
        for x in (cx - radius).max(0)..(cx + radius + 1).min(width as i64) {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius * radius {
                let idx = ((y * width as i64 + x) * 4) as usize;
                if idx + 3 < rgba.len() {
                    rgba[idx..idx + 4].copy_from_slice(&color);
                }
            }
        }
    }
}

fn stamped_icon(
    app: &tauri::AppHandle<Wry>,
    dot: StackDot,
) -> Option<tauri::image::Image<'static>> {
    let base = app.default_window_icon()?;
    let (width, height) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    stamp_dot(&mut rgba, width, height, dot.rgba());
    Some(tauri::image::Image::new_owned(rgba, width, height))
}

fn show_main_window(app: &tauri::AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// "Switch machine": bring the window up and navigate it back to the bundled
/// launcher (the connection picker), regardless of what it currently shows.
fn back_to_picker(app: &tauri::AppHandle<Wry>) {
    show_main_window(app);
    let Some(url) = crate::ssh::commands::launcher_url(app) else {
        return;
    };
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.navigate(url);
        }
    });
}

/// "Stop stack" without quitting: `run.py --stop` on whatever this session
/// is connected to — the active SSH profile if there is one, otherwise the
/// local checkout. Fire-and-forget; the health poller shows the result.
fn stop_stack(app: &tauri::AppHandle<Wry>) {
    use crate::ssh::SshTransport;
    let tunnels = app.state::<crate::ssh::commands::TunnelState>();
    if let Some(profile) = tunnels.active_profile() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Emitter;
            let Ok(session) = crate::remote::connect_session(&app, &profile).await else {
                return;
            };
            let command = crate::remote::stop_command(&crate::remote::repo_path(&profile));
            let line_app = app.clone();
            let _ = session
                .exec_stream(
                    &command,
                    |line| {
                        let _ = line_app.emit(crate::remote::REMOTE_STOP_EVENT, line);
                    },
                    |_| {},
                )
                .await;
            session.close().await;
        });
        return;
    }

    let state = app.state::<crate::state::LauncherState>();
    let checkout = state.checkout.lock().ok().and_then(|g| g.clone());
    let Some(checkout) = checkout else { return };
    let Ok(logs) = crate::launcher::log_dir(app) else {
        return;
    };
    let line_app = app.clone();
    let _ = crate::launcher::spawn_streaming(
        &crate::launcher::stop_spec(&checkout, logs.join("stop.log")),
        state.child.clone(),
        move |line| {
            use tauri::Emitter;
            let _ = line_app.emit(crate::launcher::STOP_LINE_EVENT, &line);
        },
        |_code| {},
    );
}

/// Build the tray and keep its dot in sync with `stack-health` events.
pub fn setup(app: &tauri::AppHandle<Wry>) -> tauri::Result<()> {
    let status = MenuItem::with_id(
        app,
        "tray-status",
        StackDot::Off.label(),
        false,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, "tray-open", "Open TT-Studio", true, None::<&str>)?;
    let switch = MenuItem::with_id(app, "tray-switch", "Switch machine", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "tray-stop", "Stop stack", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &switch,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("TT-Studio")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => show_main_window(app),
            "tray-switch" => back_to_picker(app),
            "tray-stop" => stop_stack(app),
            // The teardown module owns quit semantics (dialogs, stop-stack);
            // a tray quit never minimizes, it actually quits.
            "tray-quit" => crate::teardown::request_quit(app),
            _ => {}
        });
    if let Some(icon) = stamped_icon(app, StackDot::Off) {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    let handle = app.clone();
    app.listen_any(crate::health::HEALTH_EVENT, move |event| {
        let dot = dot_from_health(event.payload());
        let app = handle.clone();
        let status = status.clone();
        let _ = handle.clone().run_on_main_thread(move || {
            let _ = status.set_text(dot.label());
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                if let Some(icon) = stamped_icon(&app, dot) {
                    let _ = tray.set_icon(Some(icon));
                }
                let _ = tray.set_tooltip(Some(format!("TT-Studio — {}", dot.label())));
            }
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn health_payload(ready: bool, statuses: &[&str]) -> String {
        let services: Vec<serde_json::Value> = statuses
            .iter()
            .map(|s| serde_json::json!({ "name": "svc", "url": "u", "status": s }))
            .collect();
        serde_json::json!({ "services": services, "ready": ready }).to_string()
    }

    #[test]
    fn dot_follows_the_health_snapshot() {
        assert_eq!(
            dot_from_health(&health_payload(true, &["up", "up"])),
            StackDot::Ready
        );
        assert_eq!(
            dot_from_health(&health_payload(false, &["up", "down"])),
            StackDot::Partial
        );
        assert_eq!(
            dot_from_health(&health_payload(false, &["unreachable", "down"])),
            StackDot::Off
        );
    }

    #[test]
    fn garbage_payloads_read_as_off() {
        assert_eq!(dot_from_health("not json"), StackDot::Off);
        assert_eq!(dot_from_health("{}"), StackDot::Off);
        assert_eq!(dot_from_health(""), StackDot::Off);
    }

    #[test]
    fn stamp_paints_only_the_corner_dot() {
        let (w, h) = (16u32, 16u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        stamp_dot(&mut rgba, w, h, StackDot::Ready.rgba());

        // The dot center is painted…
        let radius = (w.min(h) as i64 / 4).max(2);
        let (cx, cy) = (w as i64 - radius - 1, h as i64 - radius - 1);
        let center = ((cy * w as i64 + cx) * 4) as usize;
        assert_eq!(&rgba[center..center + 4], &StackDot::Ready.rgba());

        // …and the opposite corner is untouched.
        assert_eq!(&rgba[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn stamp_survives_tiny_and_empty_icons() {
        // Must never panic on odd sizes.
        let mut tiny = vec![0u8; 4];
        stamp_dot(&mut tiny, 1, 1, [1, 2, 3, 4]);
        let mut empty: Vec<u8> = Vec::new();
        stamp_dot(&mut empty, 0, 0, [1, 2, 3, 4]);
    }

    #[test]
    fn labels_and_colors_are_distinct() {
        let dots = [StackDot::Ready, StackDot::Partial, StackDot::Off];
        for (i, a) in dots.iter().enumerate() {
            for b in dots.iter().skip(i + 1) {
                assert_ne!(a.label(), b.label());
                assert_ne!(a.rgba(), b.rgba());
            }
        }
    }
}
