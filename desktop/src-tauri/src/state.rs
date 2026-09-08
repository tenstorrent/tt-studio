// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

//! Shared state for the native launcher's child process.
//!
//! At most one `run.py` child (bring-up or `--stop`) runs at a time. The
//! child lives in a shared slot: the spawner puts it there, the stdout
//! reader thread takes it back out to reap it on EOF, and `kill` signals it
//! in place. `run.py` bootstrap re-execs (execve) into its own venv, so PID
//! and stdout survive — the slot always holds "the" launcher process.

use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

/// Slot holding the currently running launcher child, shared between the
/// spawner, the reader/reaper thread, and kill/quit paths.
pub type ChildSlot = Arc<Mutex<Option<Child>>>;

#[derive(Default)]
pub struct LauncherState {
    pub child: ChildSlot,
    /// Checkout the last child was spawned in; quit-time `--stop` reuses it.
    pub checkout: Mutex<Option<PathBuf>>,
    /// True once this session started a bring-up or attached to the local
    /// stack — gates the "stop the stack?" quit dialog.
    pub local_stack: AtomicBool,
    /// True while the quit flow (dialog or `--stop`) is in flight, so a
    /// second close request doesn't start it again.
    pub quitting: AtomicBool,
}
