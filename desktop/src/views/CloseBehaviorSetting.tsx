// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import {
  getCloseBehavior,
  setCloseBehavior,
  type CloseBehavior,
} from "../lib/ipc";

const LABELS: Record<CloseBehavior, string> = {
  ask: "ask every time",
  minimize_to_tray: "minimize to tray",
  keep_running: "keep the stack running",
  stop_stack: "stop the stack",
};

/**
 * What the window close button does: ask via the quit dialogs (default),
 * minimize to the tray, quit leaving the stack up, or stop the stack (local
 * or remote) on the way out. Stored with the app settings (teardown.rs).
 */
function CloseBehaviorSetting() {
  const [behavior, setBehavior] = useState<CloseBehavior | null>(null);

  useEffect(() => {
    getCloseBehavior()
      .then(setBehavior)
      .catch(() => setBehavior("ask"));
  }, []);

  if (!behavior) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500">
      On close:
      <select
        data-testid="close-behavior"
        value={behavior}
        onChange={(e) => {
          const next = e.target.value as CloseBehavior;
          setBehavior(next);
          setCloseBehavior(next).catch(() => {});
        }}
        className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
      >
        {(Object.keys(LABELS) as CloseBehavior[]).map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default CloseBehaviorSetting;
