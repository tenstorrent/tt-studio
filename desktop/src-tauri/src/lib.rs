// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

pub mod bug_report;
mod commands;
mod hardware;
mod health;
pub mod launcher;
pub mod logs;
pub mod menu;
pub mod port_clear;
pub mod port_holder;
pub mod profiles;
pub mod remote;
mod secrets;
pub mod session;
pub mod ssh;
pub mod ssh_config;
pub mod stack_checkout;
pub mod state;
pub mod teardown;
pub mod tray;
pub mod update;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin so a second launch is caught before any
        // other state exists: it focuses the running window (un-hiding a
        // minimized-to-tray one) instead of starting a second stack manager.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // Shell self-update from tagged GitHub releases. The updater pubkey
        // in tauri.conf.json is a PLACEHOLDER generated for development —
        // release CI must replace it with the real signing key before
        // shipping updater artifacts (see desktop/README.md).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Rust-side only (reveal the bug-report ZIP); no webview permission
        // is granted in capabilities/default.json.
        .plugin(tauri_plugin_opener::init())
        .manage(health::PollerState::default())
        .manage(ssh::commands::TunnelState::default())
        .manage(remote::RemoteState::default())
        .manage(state::LauncherState::default())
        .manage(session::ResumeState::default())
        // macOS only: our own Quit item, so Cmd+Q reaches the same teardown
        // decision as the close button instead of an unstoppable terminate:.
        .menu(|handle| {
            #[cfg(target_os = "macos")]
            return menu::build(handle);
            #[cfg(not(target_os = "macos"))]
            return tauri::menu::Menu::default(handle);
        })
        .setup(|app| {
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| menu::on_menu_event(app, event.id().as_ref()))
        // Close-button behavior is a setting (teardown.rs): ask via the
        // stop-or-leave dialog / ssh quit prompt (default), minimize to the
        // tray, quit leaving the stack running, or stop the stack first.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                teardown::on_close_requested(window, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_stack,
            commands::open_terms,
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            profiles::mark_profile_used,
            ssh_config::detect_ssh_hosts,
            ssh_config::adopt_detected_host,
            secrets::set_ssh_key_passphrase,
            secrets::clear_ssh_key_passphrase,
            secrets::has_ssh_key_passphrase,
            ssh::known_hosts::trust_host_key,
            port_clear::prepare_local_ports,
            ssh::commands::start_ssh_tunnels,
            ssh::commands::stop_ssh_tunnels,
            ssh::commands::get_tunnel_status,
            ssh::commands::get_session_info,
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
            logs::list_app_logs,
            logs::read_app_log,
            logs::export_app_log,
            bug_report::create_bug_report,
            update::stack::check_stack_freshness,
            update::stack::run_stack_switch,
            update::stack::get_stack_update_policy,
            update::stack::set_stack_update_policy,
            teardown::get_close_behavior,
            teardown::set_close_behavior,
            teardown::cancel_quit,
            session::take_resume_target,
            session::clear_last_session,
            session::suppress_resume,
            session::get_resume_on_launch,
            session::set_resume_on_launch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Exit routes the window's close button never sees: macOS Cmd+Q and
        // Dock -> Quit arrive as Exit with nothing to veto, so the record is
        // written there; ExitRequested is where a preventable exit lands.
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { code, api, .. } => {
                teardown::on_exit_requested(app, code, &api);
            }
            tauri::RunEvent::Exit => session::record_on_exit(app),
            _ => {}
        });
}
