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
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
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
