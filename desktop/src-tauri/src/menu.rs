// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! The macOS application menu.
//!
//! Tauri installs `Menu::default()` on macOS when the app sets no menu, and
//! its Quit item is muda's *predefined* quit — which maps straight to
//! `terminate:`. tao only registers `applicationWillTerminate:` (there is no
//! `applicationShouldTerminate:`), so that path reaches the app as
//! `RunEvent::Exit` with nothing to veto: Cmd+Q, the app menu's Quit and
//! Dock → Quit all bypassed `teardown::close_action` entirely and killed the
//! app with a remote stack still holding the box.
//!
//! The fix is to own that one item. We build the default menu and *swap* the
//! predefined Quit for a normal menu item that emits an event we can route,
//! rather than rebuilding the menu from scratch: the default Edit submenu's
//! predefined copy/paste/undo items are what make those shortcuts work in
//! WKWebView, and hand-rolling them is a regression waiting to happen.
//!
//! Linux and Windows build no default menu, so none of this applies there.

/// Emitted by our replacement Quit item.
pub const QUIT_ID: &str = "app-quit";
/// Emitted by the Window submenu's "Switch machine" item.
pub const SWITCH_ID: &str = "app-switch";

/// Whether a predefined item's label is the Quit one. muda renders it with a
/// mnemonic ampersand, and as "Exit" on Windows.
pub fn is_quit_item(text: &str) -> bool {
    let cleaned = text.replace('&', "");
    let cleaned = cleaned.trim();
    cleaned.eq_ignore_ascii_case("quit") || cleaned.eq_ignore_ascii_case("exit")
}

#[cfg(target_os = "macos")]
pub fn setup(app: &tauri::AppHandle<tauri::Wry>) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};

    let menu = Menu::default(app)?;
    let mut swapped = false;

    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else {
            continue;
        };
        if replace_quit(app, &submenu)? {
            swapped = true;
            break;
        }
    }

    // A future Tauri could restructure the default menu. Losing the swap costs
    // us the quit prompt, which is what shipped before — never a crash.
    debug_assert!(swapped, "no predefined Quit item found in the default menu");
    if !swapped {
        eprintln!("tt-studio: could not take over the Quit menu item");
    }

    if let Some(window_menu) = find_submenu(&menu, "window")? {
        window_menu.append(&MenuItem::with_id(
            app,
            SWITCH_ID,
            "Switch Machine",
            true,
            Some("CmdOrCtrl+Shift+M"),
        )?)?;
    }

    app.set_menu(menu)?;
    Ok(())
}

/// Swap the predefined Quit inside one submenu. True when it was there.
#[cfg(target_os = "macos")]
fn replace_quit(
    app: &tauri::AppHandle<tauri::Wry>,
    submenu: &tauri::menu::Submenu<tauri::Wry>,
) -> tauri::Result<bool> {
    use tauri::menu::{MenuItem, MenuItemKind};

    for entry in submenu.items()? {
        let MenuItemKind::Predefined(predefined) = &entry else {
            continue;
        };
        if !predefined.text().is_ok_and(|text| is_quit_item(&text)) {
            continue;
        }
        submenu.remove(&entry)?;
        submenu.append(&MenuItem::with_id(
            app,
            QUIT_ID,
            "Quit TT-Studio",
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
        return Ok(true);
    }
    Ok(false)
}

#[cfg(target_os = "macos")]
fn find_submenu(
    menu: &tauri::menu::Menu<tauri::Wry>,
    name: &str,
) -> tauri::Result<Option<tauri::menu::Submenu<tauri::Wry>>> {
    use tauri::menu::MenuItemKind;

    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text().is_ok_and(|t| t.eq_ignore_ascii_case(name)) {
                return Ok(Some(submenu));
            }
        }
    }
    Ok(None)
}

/// Route a menu event. Unknown ids are ignored — the predefined items handle
/// themselves and never reach here.
pub(crate) fn on_menu_event(app: &tauri::AppHandle<tauri::Wry>, id: &str) {
    match id {
        QUIT_ID => crate::teardown::request_quit(app),
        SWITCH_ID => crate::tray::back_to_picker(app),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::is_quit_item;

    #[test]
    fn recognizes_the_predefined_quit_label() {
        for text in ["&Quit", "Quit", "&Exit", "Exit", "quit", " &Quit "] {
            assert!(is_quit_item(text), "{text} should be the quit item");
        }
    }

    #[test]
    fn does_not_match_its_neighbours() {
        for text in [
            "Close Window",
            "Hide",
            "About TT-Studio",
            "Quit TT-Studio",
            "Services",
            "",
        ] {
            assert!(!is_quit_item(text), "{text} should not be the quit item");
        }
    }
}
