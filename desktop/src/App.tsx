// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// The real TT-Studio frontend is served by the stack itself — the desktop
// shell navigates this window to it rather than bundling it (the web app
// derives URLs from window.location, so it must load from its own origin).
const STACK_URL = "http://localhost:3000";

function App() {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const openStack = async () => {
    setOpening(true);
    setError(null);
    try {
      await invoke("open_stack", { url: STACK_URL });
      // On success the window navigates away from the launcher entirely.
    } catch (e) {
      setError(String(e));
      setOpening(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100">
      <h1 className="text-3xl font-semibold tracking-tight">TT-Studio</h1>
      <p className="text-sm text-zinc-400">Desktop launcher</p>
      <button
        type="button"
        onClick={openStack}
        disabled={opening}
        className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50"
      >
        {opening ? "Opening…" : "Open TT-Studio"}
      </button>
      <p className="text-xs text-zinc-500">{STACK_URL}</p>
      {error && (
        <p className="max-w-md text-center text-xs text-red-400">
          Couldn&apos;t open the stack: {error}. Is TT-Studio running? Start it
          with <code className="text-zinc-300">python run.py</code>.
        </p>
      )}
    </main>
  );
}

export default App;
