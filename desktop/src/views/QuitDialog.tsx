// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Quit dialog shown when the window is closed while an SSH connection is
// active: stop the remote stack first, or just disconnect and leave it
// running. Pure view — all IPC stays in App.

interface Props {
  /** Machine name for the wording; null when no remote is active. */
  machine: string | null;
  /** A stop is running; its streamed output is in `lines`. */
  stopping: boolean;
  lines: string[];
  /** The stop failed; offer quit-anyway. */
  error: string | null;
  onStopAndQuit: () => void;
  onDisconnectQuit: () => void;
  onCancel: () => void;
}

function QuitDialog({
  machine,
  stopping,
  lines,
  error,
  onStopAndQuit,
  onDisconnectQuit,
  onCancel,
}: Props) {
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
      </header>

      {(stopping || lines.length > 0) && (
        <pre
          data-testid="quit-stop-output"
          className="max-h-48 w-full max-w-md overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300"
        >
          {lines.length > 0 ? lines.join("\n") : `Stopping the stack on ${machine}…`}
        </pre>
      )}

      {error && (
        <p
          data-testid="quit-error"
          className="w-full max-w-md rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300"
        >
          Couldn't stop the stack: {error}
        </p>
      )}

      <div className="flex flex-col items-center gap-3">
        {machine && !error && (
          <button
            type="button"
            onClick={onStopAndQuit}
            disabled={stopping}
            data-testid="quit-stop"
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {stopping ? "Stopping…" : `Stop the stack on ${machine} and quit`}
          </button>
        )}
        <button
          type="button"
          onClick={onDisconnectQuit}
          disabled={stopping}
          data-testid="quit-disconnect"
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
        >
          {error ? "Quit anyway (leave it running)" : "Just disconnect and quit"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={stopping}
          data-testid="quit-cancel"
          className="rounded-md px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
        >
          Cancel — back to TT-Studio
        </button>
      </div>
    </main>
  );
}

export default QuitDialog;
