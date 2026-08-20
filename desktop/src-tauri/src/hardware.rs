// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Tenstorrent hardware presence probe.
//!
//! The first-run picker uses this to choose its default: a machine with a
//! Tenstorrent accelerator pre-selects "run locally", anything else defaults
//! to connecting over SSH. Full deployment needs `/dev/tenstorrent`, which
//! only exists on Linux hosts with the driver loaded. The platform rides
//! along so the picker can explain *why* local mode is unavailable (wrong
//! OS vs. missing device/driver).

use serde::Serialize;
use std::path::Path;

/// Device node the tt-kmd driver exposes on Linux.
pub const TENSTORRENT_DEV: &str = "/dev/tenstorrent";

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DefaultMode {
    Local,
    Ssh,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Linux,
    Macos,
    Windows,
    Other,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "linux") {
            Platform::Linux
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Other
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct HardwareProbe {
    pub platform: Platform,
    pub accelerator_present: bool,
    pub default_mode: DefaultMode,
}

/// Pure gating logic: local mode only makes sense on Linux with the device
/// node present; everything else should steer the picker to SSH.
pub fn probe(platform: Platform, dev_path: &Path) -> HardwareProbe {
    let accelerator_present = platform == Platform::Linux && dev_path.exists();
    HardwareProbe {
        platform,
        accelerator_present,
        default_mode: if accelerator_present {
            DefaultMode::Local
        } else {
            DefaultMode::Ssh
        },
    }
}

#[tauri::command]
pub fn detect_hardware() -> HardwareProbe {
    probe(Platform::current(), Path::new(TENSTORRENT_DEV))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_with_device_defaults_to_local() {
        let dir = std::env::temp_dir();
        let probe = probe(Platform::Linux, &dir); // any existing path stands in for /dev/tenstorrent
        assert!(probe.accelerator_present);
        assert_eq!(probe.default_mode, DefaultMode::Local);
    }

    #[test]
    fn linux_without_device_defaults_to_ssh() {
        let probe = probe(
            Platform::Linux,
            Path::new("/nonexistent/tenstorrent-test-path"),
        );
        assert!(!probe.accelerator_present);
        assert_eq!(probe.default_mode, DefaultMode::Ssh);
    }

    #[test]
    fn non_linux_defaults_to_ssh_even_if_path_exists() {
        let dir = std::env::temp_dir();
        for platform in [Platform::Macos, Platform::Windows, Platform::Other] {
            let probe = probe(platform, &dir);
            assert!(!probe.accelerator_present);
            assert_eq!(probe.default_mode, DefaultMode::Ssh);
        }
    }

    #[test]
    fn probe_serializes_for_the_ui() {
        let json = serde_json::to_value(probe(Platform::Macos, Path::new("/nope"))).unwrap();
        assert_eq!(json["platform"], "macos");
        assert_eq!(json["accelerator_present"], false);
        assert_eq!(json["default_mode"], "ssh");
    }
}
