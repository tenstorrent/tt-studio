// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Quit dialog shown when the app is closed while an SSH connection is
// active: leave the remote stack running, or stop it first. Pure view — all
// IPC stays in App.
//
// Leaving it running is the primary action on purpose. A QuietBox is usually
// shared, and one person closing a laptop app should not tear down a stack
// someone else may be using; stopping it is one deliberate click away.

import type { StackHealth } from "../lib/ipc";
import { btnPrimary, btnSecondary, btnTertiary, errorCard, logPre } from "./ui";

interface Props {
  /** Machine name for the wording; null when no remote is active. */
  machine: string | null;
  /** A stop is running; its streamed output is in `lines`. */
  stopping: boolean;
  lines: string[];
  /** The stop failed; offer quit-anyway. */
  error: string | null;
  /** Pre-formatted session duration, e.g. "2h 14m". Null when unknown. */
  sessionAge: string | null;
  /** Arrives after the dialog does; must never gate the buttons. */
  health: StackHealth | null;
  /** Persist this choice as the default for future closes. */
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
  onStopAndQuit: () => void;
  onDisconnectQuit: () => void;
  onCancel: () => void;
}

/** "3 of 5 services running" — what stopping would actually take down. */
function summarize(health: StackHealth | null): string | null {
  if (!health || health.services.length === 0) return null;
  const up = health.services.filter((s) => s.status === "up").length;
  return `${up} of ${health.services.length} services running`;
}

function QuitDialog({
  machine,
  stopping,
  lines,
  error,
  sessionAge,
  health,
  remember,
  onRememberChange,
  onStopAndQuit,
  onDisconnectQuit,
  onCancel,
}: Props) {
  const running = summarize(health);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <header className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {machine ? `Disconnect from ${machine}?` : "Quit TT-Studio?"}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {machine
            ? `The TT-Studio stack on ${machine} keeps running (and holding the hardware) unless you stop it.`
            : "No remote connection is active."}
        </p>
        {(sessionAge || running) && (
          <p data-testid="quit-session" className="mt-2 text-xs text-zinc-500">
            {[sessionAge && `Connected ${sessionAge}`, running]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </header>

      {(stopping || lines.length > 0) && (
        <pre data-testid="quit-stop-output" className={`max-h-48 max-w-md ${logPre}`}>
          {lines.length > 0
            ? lines.join("\n")
            : `Stopping the stack on ${machine}…`}
        </pre>
      )}

      {error && (
        <p
          data-testid="quit-error"
          className={`w-full max-w-md px-3 py-2 text-xs text-red-300 ${errorCard}`}
        >
          Couldn't stop the stack: {error}
        </p>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onDisconnectQuit}
          disabled={stopping}
          data-testid="quit-disconnect"
          className={btnPrimary}
        >
          {error ? "Quit anyway (leave it running)" : "Just disconnect and quit"}
        </button>
        {machine && !error && (
          <button
            type="button"
            onClick={onStopAndQuit}
            disabled={stopping}
            data-testid="quit-stop"
            className={btnSecondary}
          >
            {stopping ? "Stopping…" : `Stop the stack on ${machine} and quit`}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={stopping}
          data-testid="quit-cancel"
          className={btnTertiary}
        >
          Cancel — back to TT-Studio
        </button>
      </div>

      {!error && (
        <label className="flex max-w-md items-start gap-2 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={remember}
            disabled={stopping}
            onChange={(e) => onRememberChange(e.target.checked)}
            data-testid="quit-remember"
            className="mt-0.5 accent-purple-600"
          />
          <span>
            Always do this when I close TT-Studio. You can change it later
            under “On close” on the machine picker.
          </span>
        </label>
      )}
    </main>
  );
}

export default QuitDialog;
