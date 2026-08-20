// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

mod commands;
mod hardware;
mod health;
pub mod profiles;
pub mod remote;
mod secrets;
pub mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(health::PollerState::default())
        .manage(ssh::commands::TunnelState::default())
        .manage(remote::RemoteState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                ssh::commands::on_close_requested(window, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_stack,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::mark_profile_used,
            secrets::set_ssh_key_passphrase,
            secrets::clear_ssh_key_passphrase,
            secrets::has_ssh_key_passphrase,
            ssh::known_hosts::trust_host_key,
            ssh::commands::start_ssh_tunnels,
            ssh::commands::stop_ssh_tunnels,
            ssh::commands::get_tunnel_status,
            remote::classify_remote_stack,
            remote::start_remote_bring_up,
            remote::cancel_remote_bring_up,
            remote::get_active_remote,
            remote::quit_app,
            hardware::detect_hardware,
            health::check_stack_health,
            health::start_health_poll,
            health::stop_health_poll,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
