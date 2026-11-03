// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Shown while the app reconnects to the machine it was last on, instead of
// the picker. Pure view — all IPC stays in App.
//
// The two exits are deliberately both here and deliberately worded
// differently: "Cancel" answers "I didn't want this right now", "Pick another
// machine" answers "I wanted a different one". An automatic reconnect without
// a visible way out is a trap, so neither is ever hidden.

import { btnSecondary, btnTertiary } from "./ui";

interface Props {
  machine: string;
  /** Pre-formatted age of the last session, e.g. "40m". Null when unknown. */
  age: string | null;
  /** One-line description of the stage in flight. */
  activity: string;
  onCancel: () => void;
  onPickAnother: () => void;
}

function ResumeGate({ machine, age, activity, onCancel, onPickAnother }: Props) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <header className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Reconnecting to {machine}…
        </h1>
        <p data-testid="resume-subline" className="mt-2 text-sm text-zinc-400">
          {age
            ? `You left the stack running here ${age} ago.`
            : "Picking up where you left off."}
        </p>
      </header>

      <p
        data-testid="resume-activity"
        className="flex items-center gap-3 text-sm text-zinc-400"
      >
        <span className="inline-block h-4 w-4 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
        {activity}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onPickAnother}
          data-testid="resume-pick-another"
          className={btnSecondary}
        >
          Pick another machine
        </button>
        <button
          type="button"
          onClick={onCancel}
          data-testid="resume-cancel"
          className={btnTertiary}
        >
          Cancel
        </button>
      </div>
    </main>
  );
}

export default ResumeGate;
