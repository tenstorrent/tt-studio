// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { getItem, setItem } from "../components/chatui/indexedDBManager";

// Single browser-session identifier sent as X-Session-Id on every connector
// + agent request. Persisted in IndexedDB so it survives a page reload but
// is wiped when `python run.py --cleanup-all` resets the cleanup sentinel.
const KEY = "tt-session-id";

let cached: string | null = null;
let initPromise: Promise<string> | null = null;

function generate(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // RFC4122-ish fallback. Browsers without crypto.randomUUID are pre-2021.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function initSessionId(): Promise<string> {
  if (cached) return cached;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const existing = await getItem<string>(KEY);
      if (typeof existing === "string" && existing.length > 0) {
        cached = existing;
        return existing;
      }
    } catch {
      // fall through to generate
    }
    const fresh = generate();
    try {
      await setItem(KEY, fresh);
    } catch {
      // best-effort; we still return the in-memory id
    }
    cached = fresh;
    return fresh;
  })();
  return initPromise;
}

export function getSessionIdSync(): string | null {
  return cached;
}
