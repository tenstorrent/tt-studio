// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

mod commands;
mod hardware;
mod health;
pub mod launcher;
mod profiles;
mod secrets;
pub mod stack_checkout;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // Quit dialog: only when this session started or attached to a local
        // stack is there anything to ask about — the host services detach
        // and survive the app on purpose, so the default is to leave them.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let launcher_state: tauri::State<state::LauncherState> = app.state();
                if !launcher_state.local_stack.load(Ordering::SeqCst) {
                    return; // nothing local: close normally
                }
                api.prevent_close();
                if launcher_state.quitting.swap(true, Ordering::SeqCst) {
                    return; // quit flow already in flight
                }
                launcher::confirm_quit(app);
            }
        })
        .manage(health::PollerState::default())
        .manage(state::LauncherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_stack,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::mark_profile_used,
            secrets::set_ssh_key_passphrase,
            secrets::clear_ssh_key_passphrase,
            secrets::has_ssh_key_passphrase,
            hardware::detect_hardware,
            health::check_stack_health,
            health::start_health_poll,
            health::stop_health_poll,
            stack_checkout::resolve_stack_checkout,
            stack_checkout::set_stack_checkout_path,
            launcher::start_bring_up,
            launcher::stop_bring_up,
            launcher::bring_up_running,
            launcher::mark_local_attach,
            launcher::restart_stack,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
