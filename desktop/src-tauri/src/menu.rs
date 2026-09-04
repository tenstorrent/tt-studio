// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! The macOS application menu.
//!
//! Tauri installs `Menu::default()` on macOS when the app sets none, and its
//! Quit item is muda's *predefined* quit, which maps straight to
//! `terminate:`. tao registers only `applicationWillTerminate:` (there is no
//! `applicationShouldTerminate:`), so that path reaches the app as
//! `RunEvent::Exit` with nothing to veto: Cmd+Q, the app menu's Quit and
//! Dock → Quit all bypassed `teardown::close_action` and killed the app with
//! a remote stack still holding the box.
//!
//! So we build the menu ourselves — the same shape Tauri's default has, with
//! our own Quit item that emits an event we can route, plus a Window entry
//! for getting back to the picker. The predefined items are kept verbatim
//! everywhere else: on macOS the Edit submenu's undo/cut/copy/paste are what
//! wire those shortcuts into WKWebView, and hand-rolling them would break
//! text editing in the stack UI.
//!
//! This has to run from `Builder::menu`, not from `setup`: every method on a
//! built menu (`items`, `text`, `append`) hops to the main thread and blocks
//! on the reply, which cannot complete while `setup` is itself holding the
//! main thread before the event loop starts.
//!
//! Linux and Windows get no default menu from Tauri, and their close-button
//! and tray routes already go through teardown, so none of this applies.

/// Emitted by our replacement Quit item.
pub const QUIT_ID: &str = "app-quit";
/// Emitted by the Window submenu's "Switch Machine" item.
pub const SWITCH_ID: &str = "app-switch";

#[cfg(target_os = "macos")]
pub fn build(app: &tauri::AppHandle<tauri::Wry>) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let pkg = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    // The one item that differs from Tauri's default: ours carries an id, so
    // Cmd+Q arrives as a menu event instead of an unstoppable terminate:.
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit TT-Studio", true, Some("CmdOrCtrl+Q"))?;

    let app_menu = Submenu::with_items(
        app,
        pkg.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;

    // Verbatim from Tauri's default: these are the webview's editing keys.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    // Once the app resumes into the stack page on launch, this is the main
    // way back to the picker: that page is a foreign origin with no IPC of
    // its own, and the tray is a small menubar glyph on macOS.
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                SWITCH_ID,
                "Switch Machine",
                true,
                Some("CmdOrCtrl+Shift+M"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

/// Route a menu event. Predefined items handle themselves and never reach
/// here, so anything unrecognized is ignored.
pub(crate) fn on_menu_event(app: &tauri::AppHandle<tauri::Wry>, id: &str) {
    match id {
        QUIT_ID => crate::teardown::request_quit(app),
        SWITCH_ID => crate::tray::back_to_picker(app),
        _ => {}
    }
}
