// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Full-screen failure card for the SSH connect flow (port conflicts, missing
// checkout, old python, probe errors). Pure view — all IPC stays in App.

import type { ConnectErrorInfo } from "../lib/connect";

interface Props {
  card: ConnectErrorInfo;
  onBack: () => void;
  /** Wired when the card says the profile itself needs fixing. */
  onEdit?: () => void;
}

function ConnectErrorCard({ card, onBack, onEdit }: Props) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <section
        data-testid="connect-error"
        className="w-full max-w-md rounded-lg border border-red-900 bg-red-950/40 p-5"
      >
        <h1 className="text-lg font-semibold text-red-300">{card.title}</h1>
        <p className="mt-2 text-sm text-red-200/80">{card.body}</p>
        {card.command && (
          <pre className="mt-3 overflow-x-auto rounded bg-zinc-900 px-3 py-2 text-xs text-zinc-200">
            <code>{card.command}</code>
          </pre>
        )}
        {card.hint && (
          <p className="mt-3 text-xs text-red-200/60">{card.hint}</p>
        )}
      </section>
      <div className="flex gap-3">
        {card.showEdit && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            data-testid="connect-error-edit"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Edit machine
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          data-testid="connect-error-back"
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Back
        </button>
      </div>
    </main>
  );
}

export default ConnectErrorCard;
