// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { clearStore } from "./components/chatui/indexedDBManager";
import { initSessionId } from "./lib/sessionId";

// Wipe browser-side state (IndexedDB chat history + localStorage) once when
// `python run.py --cleanup-all` has armed the sentinel at /.cleanup-pending.
// The CLI writes a fresh token (ms timestamp) to that file; after wiping we
// stash the token in localStorage so we don't re-wipe on every page load.
const CLEANUP_ACK_KEY = "cleanup_ack_token";

// Token format: pure digits (ms timestamp written by run.py). Anything else
// is treated as the SPA index.html fallback (Vite/nginx serve index.html when
// the sentinel file does not exist) and ignored.
const TOKEN_RE = /^\d{10,16}$/;

async function applyCleanupSentinel(): Promise<void> {
  let token: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch("/.cleanup-pending", {
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("text/html")) return;
    token = (await res.text()).trim();
    if (!TOKEN_RE.test(token)) return;
  } catch {
    return;
  }

  try {
    if (localStorage.getItem(CLEANUP_ACK_KEY) === token) return;
  } catch {
    // localStorage unavailable; proceed to wipe anyway
  }

  try {
    await clearStore();
  } catch (e) {
    console.warn("cleanup: IndexedDB clear failed", e);
  }
  try {
    localStorage.clear();
  } catch (e) {
    console.warn("cleanup: localStorage clear failed", e);
  }
  try {
    localStorage.setItem(CLEANUP_ACK_KEY, token);
  } catch {
    // best-effort; if this fails the wipe will fire again next load
  }
}

applyCleanupSentinel()
  .finally(() => initSessionId().catch(() => undefined))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
