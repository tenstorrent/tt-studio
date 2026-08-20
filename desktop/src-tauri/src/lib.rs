// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

mod commands;
mod hardware;
mod health;
pub mod launcher;
pub mod profiles;
pub mod remote;
mod secrets;
pub mod ssh;
pub mod stack_checkout;
pub mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(health::PollerState::default())
        .manage(ssh::commands::TunnelState::default())
        .manage(remote::RemoteState::default())
        .manage(state::LauncherState::default())
        // Quit handling picks the path that matches how this session runs the
        // stack: a locally spawned/attached stack gets the stop-or-leave
        // dialog; an SSH session with live tunnels gets the in-app quit
        // prompt; anything else closes normally (host services detach and
        // survive the app on purpose).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let launcher_state: tauri::State<state::LauncherState> = app.state();
                if launcher_state.local_stack.load(Ordering::SeqCst) {
                    api.prevent_close();
                    if launcher_state.quitting.swap(true, Ordering::SeqCst) {
                        return; // quit flow already in flight
                    }
                    launcher::confirm_quit(app);
                    return;
                }
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
