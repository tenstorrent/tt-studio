// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Shell self-update via the Tauri updater plugin. The update feed is the
// `latest.json` asset attached to tagged GitHub releases of
// tenstorrent/tt-studio (see tauri.conf.json), so the shell only ever moves
// between released versions — never raw main.

import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface ShellUpdate {
  version: string;
  body?: string;
  /** Download the new shell, install it, and relaunch the app. */
  install: () => Promise<void>;
}

/**
 * Ask the release feed whether a newer shell exists. Resolves null when
 * already current; rejects when the feed is unreachable (offline) — callers
 * decide whether that's silent (launch check) or surfaced (manual check).
 */
export async function checkShellUpdate(): Promise<ShellUpdate | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    body: update.body ?? undefined,
    install: async () => {
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}
