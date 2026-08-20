// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Tenstorrent hardware presence probe.
//!
//! The first-run picker uses this to choose its default: a machine with a
//! Tenstorrent accelerator pre-selects "run locally", anything else defaults
//! to connecting over SSH. Full deployment needs `/dev/tenstorrent`, which
//! only exists on Linux hosts with the driver loaded.

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
pub struct HardwareProbe {
    pub accelerator_present: bool,
    pub default_mode: DefaultMode,
}

/// Pure gating logic: local mode only makes sense on Linux with the device
/// node present; everything else should steer the picker to SSH.
pub fn probe_at(is_linux: bool, dev_path: &Path) -> HardwareProbe {
    let accelerator_present = is_linux && dev_path.exists();
    HardwareProbe {
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
    probe_at(cfg!(target_os = "linux"), Path::new(TENSTORRENT_DEV))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_with_device_defaults_to_local() {
        let dir = std::env::temp_dir();
        let probe = probe_at(true, &dir); // any existing path stands in for /dev/tenstorrent
        assert!(probe.accelerator_present);
        assert_eq!(probe.default_mode, DefaultMode::Local);
    }

    #[test]
    fn linux_without_device_defaults_to_ssh() {
        let probe = probe_at(true, Path::new("/nonexistent/tenstorrent-test-path"));
        assert!(!probe.accelerator_present);
        assert_eq!(probe.default_mode, DefaultMode::Ssh);
    }

    #[test]
    fn non_linux_defaults_to_ssh_even_if_path_exists() {
        let dir = std::env::temp_dir();
        let probe = probe_at(false, &dir);
        assert!(!probe.accelerator_present);
        assert_eq!(probe.default_mode, DefaultMode::Ssh);
    }

    #[test]
    fn probe_serializes_for_the_ui() {
        let json = serde_json::to_value(probe_at(true, Path::new("/nope"))).unwrap();
        assert_eq!(json["accelerator_present"], false);
        assert_eq!(json["default_mode"], "ssh");
    }
}
