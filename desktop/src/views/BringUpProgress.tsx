// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Native rendering of the launcher's bring-up stream (--json-events): a
// phase stepper, notes/warnings, error cards with remediation, and the
// ready → open-the-stack transition. Pure view over BringUpState.

import { useEffect } from "react";
import type { BringUpState, PhaseState } from "../lib/events";

function PhaseRow({ phase, total }: { phase: PhaseState; total: number | null }) {
  const icon =
    phase.status === "ok" ? (
      <span className="text-emerald-400">✓</span>
    ) : phase.status === "failed" ? (
      <span className="text-red-400">✕</span>
    ) : (
      <span className="inline-block h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
    );
  return (
    <li
      data-testid={`phase-${phase.name}`}
      className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
    >
      <span className="w-4 text-center">{icon}</span>
      <span className="text-xs text-zinc-500">
        {phase.index}
        {total ? `/${total}` : ""}
      </span>
      <span className="font-medium">{phase.name}</span>
      {phase.status === "running" && phase.activity && (
        <span className="truncate text-xs text-zinc-400">
          {phase.activity}
        </span>
      )}
      {phase.durationS !== undefined && (
        <span className="ml-auto text-xs text-zinc-500">
          {phase.durationS.toFixed(1)}s
        </span>
      )}
    </li>
  );
}

interface Props {
  state: BringUpState;
  /** Called once the launcher reports ready and the app URL is known. */
  onReady: (appUrl: string) => void;
  /** When set, renders a cancel button that aborts the bring-up. */
  onCancel?: () => void;
}

function BringUpProgress({ state, onReady, onCancel }: Props) {
  const appUrl = state.ready?.urls.app;
  useEffect(() => {
    if (appUrl) onReady(appUrl);
  }, [appUrl, onReady]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 py-10 text-zinc-100">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Starting TT-Studio
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {state.ready
            ? `Ready${state.ready.hardware ? ` on ${state.ready.hardware}` : ""} — opening…`
            : state.errors.length > 0
              ? "Bring-up hit a problem"
              : "Setting up services on the machine"}
        </p>
      </header>

      <ol className="flex w-full max-w-md flex-col gap-2">
        {state.phases.map((phase) => (
          <PhaseRow key={phase.name} phase={phase} total={state.totalPhases} />
        ))}
      </ol>

      {(state.notes.length > 0 || state.warnings.length > 0) && (
        <section className="flex w-full max-w-md flex-col gap-1">
          {state.notes.map((note, i) => (
            <p key={`n${i}`} className="text-xs text-zinc-400">
              {note}
            </p>
          ))}
          {state.warnings.map((warning, i) => (
            <p
              key={`w${i}`}
              data-testid="bringup-warning"
              className="text-xs text-amber-400"
            >
              ⚠ {warning}
            </p>
          ))}
        </section>
      )}

      {state.errors.map((err, i) => (
        <section
          key={i}
          data-testid="bringup-error"
          className="w-full max-w-md rounded-lg border border-red-900 bg-red-950/40 p-4"
        >
          <p className="text-sm font-medium text-red-300">
            {err.service ? `${err.service}: ` : ""}
            {err.message}
          </p>
          {err.remediation && (
            <p className="mt-2 text-xs text-red-200/80">
              Try:{" "}
              <code className="rounded bg-zinc-900 px-1 py-0.5">
                {err.remediation}
              </code>
            </p>
          )}
          {err.log && (
            <p className="mt-1 text-xs text-red-200/60">Log: {err.log}</p>
          )}
        </section>
      ))}

      {state.promptBlocked && (
        <section
          data-testid="bringup-prompt-blocked"
          className="w-full max-w-md rounded-lg border border-amber-900 bg-amber-950/40 p-4"
        >
          <p className="text-sm font-medium text-amber-300">
            The launcher needs input it can't ask for here
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            {state.promptBlocked.prompt}
          </p>
          {state.promptBlocked.remediation && (
            <p className="mt-2 text-xs text-amber-200/80">
              Try:{" "}
              <code className="rounded bg-zinc-900 px-1 py-0.5">
                {state.promptBlocked.remediation}
              </code>
            </p>
          )}
        </section>
      )}

      {onCancel && !state.ready && (
        <button
          type="button"
          onClick={onCancel}
          data-testid="bringup-cancel"
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          {state.errors.length > 0 ? "Back" : "Cancel"}
        </button>
      )}
    </main>
  );
}

export default BringUpProgress;
