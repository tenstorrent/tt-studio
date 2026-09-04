// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Ask before running `run.py --switch` (the default "prompt" policy).
 * Skipping is always safe — bring-up proceeds on the current version.
 */
export function StackUpdatePrompt({
  from,
  to,
  machine,
  onUpdate,
  onSkip,
}: {
  from: string;
  to: string;
  machine: string | null;
  onUpdate: () => void;
  onSkip: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <header className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          Stack update available
        </h1>
        <p className="mt-2 text-sm text-zinc-400" data-testid="stack-update-versions">
          {machine ? `${machine} is` : "Your stack is"} on {from}; the latest
          release is {to}. Updating switches the checkout and pulls the
          matching images before starting.
        </p>
      </header>
      <div className="flex gap-3">
        <button
          type="button"
          data-testid="stack-update-now"
          onClick={onUpdate}
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
        >
          Update to {to}
        </button>
        <button
          type="button"
          data-testid="stack-update-skip"
          onClick={onSkip}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Not now
        </button>
      </div>
    </main>
  );
}

/** Streamed `run.py --switch` output while the stack updates. */
export function StackSwitchProgress({
  to,
  lines,
}: {
  to: string;
  lines: string[];
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-zinc-100">
      <header className="text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          Updating the stack to {to}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Running run.py --switch — bring-up starts when it finishes.
        </p>
      </header>
      <pre
        data-testid="stack-switch-lines"
        className="max-h-64 w-full max-w-xl overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400"
      >
        {lines.length > 0 ? lines.join("\n") : "Starting…"}
      </pre>
    </main>
  );
}
