// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! The app's two update layers.
//!
//! - The **shell** (this Tauri app) self-updates via the tauri updater
//!   plugin, configured in tauri.conf.json against tagged GitHub releases.
//! - The **stack** (the tt-studio checkout a connect runs `run.py` in) is
//!   refreshed to the latest `v*` release tag before bring-up — see
//!   [`stack`].

pub mod stack;
