// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// When this tab's session of deployments began. A deployment started since then is
// one the user is working with, even if it died before any page showed it running
// (a model that fails in its first seconds). Started when the app loads, not when a
// page mounts: a deploy is usually started from one page and watched on another.
// Kept per tab so a reload does not lose it; Reset All restarts it.

const SESSION_START_KEY = "tt-studio-deploy-session-start";

let inMemoryStart: number | null = null;

export function deploySessionStart(): number {
  try {
    const stored = Number(sessionStorage.getItem(SESSION_START_KEY));
    if (stored > 0) return stored;
  } catch {
    // storage unavailable: fall back to the in-memory value
  }
  return inMemoryStart ?? restartDeploySession();
}

export function restartDeploySession(): number {
  inMemoryStart = Date.now();
  try {
    sessionStorage.setItem(SESSION_START_KEY, String(inMemoryStart));
  } catch {
    // storage unavailable: keep the in-memory value only
  }
  return inMemoryStart;
}
