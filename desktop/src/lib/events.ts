// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Types and reducer for the launcher's machine-readable bring-up stream
// (`python run.py --json-events`). Mirrors the NDJSON schema documented in
// dev-docs/json-events.md: one JSON object per line with a stable envelope
// {v, ts, event, phase, detail}. Consumers must skip unparseable lines and
// tolerate unknown event types / extra detail keys (non-breaking within v1).

export type BringUpEventType =
  | "phase_begin"
  | "phase_end"
  | "progress"
  | "note"
  | "warn"
  | "error"
  | "prompt_blocked"
  | "ready"
  | "status";

export interface BringUpEvent {
  v: number;
  ts: number;
  event: BringUpEventType | (string & {});
  phase: string | null;
  detail: Record<string, unknown>;
}

/**
 * Parse one NDJSON line. Returns null for anything that isn't a v1 event
 * envelope — e.g. the plain bootstrap lines a fresh checkout prints before
 * the CLI exists — so callers can simply filter.
 */
export function parseEventLine(line: string): BringUpEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const obj = value as Record<string, unknown>;
  if (obj.v !== 1 || typeof obj.event !== "string") return null;
  return {
    v: 1,
    ts: typeof obj.ts === "number" ? obj.ts : 0,
    event: obj.event,
    phase: typeof obj.phase === "string" ? obj.phase : null,
    detail:
      typeof obj.detail === "object" && obj.detail !== null
        ? (obj.detail as Record<string, unknown>)
        : {},
  };
}

// ---- reducer: fold the event stream into renderable bring-up state ----

export type PhaseStatus = "running" | "ok" | "failed";

export interface PhaseState {
  name: string;
  index: number;
  status: PhaseStatus;
  durationS?: number;
  /** Latest sub-step reported via progress events while running. */
  activity?: string;
}

export interface BringUpError {
  message: string;
  remediation?: string;
  service?: string;
  log?: string;
}

export interface ReadyInfo {
  urls: Record<string, string>;
  hardware?: string;
}

export interface BringUpState {
  phases: PhaseState[];
  totalPhases: number | null;
  notes: string[];
  warnings: string[];
  errors: BringUpError[];
  promptBlocked: { prompt: string; remediation?: string } | null;
  ready: ReadyInfo | null;
}

export function initialBringUpState(): BringUpState {
  return {
    phases: [],
    totalPhases: null,
    notes: [],
    warnings: [],
    errors: [],
    promptBlocked: null,
    ready: null,
  };
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Fold one event into the state. Returns a new state object. */
export function reduceEvent(
  state: BringUpState,
  event: BringUpEvent,
): BringUpState {
  const d = event.detail;
  switch (event.event) {
    case "phase_begin": {
      const phase: PhaseState = {
        name: event.phase ?? `Phase ${state.phases.length + 1}`,
        index:
          typeof d.index === "number" ? d.index : state.phases.length + 1,
        status: "running",
      };
      return {
        ...state,
        totalPhases:
          typeof d.total === "number" ? d.total : state.totalPhases,
        phases: [...state.phases, phase],
      };
    }
    case "phase_end": {
      const phases = state.phases.map((p) =>
        p.name === event.phase && p.status === "running"
          ? {
              ...p,
              status: (d.status === "ok" ? "ok" : "failed") as PhaseStatus,
              durationS:
                typeof d.duration_s === "number" ? d.duration_s : undefined,
              activity: undefined,
            }
          : p,
      );
      return { ...state, phases };
    }
    case "progress": {
      // A retitle (Pull → Build fallback) renames the running phase; any
      // other progress updates its current activity line.
      if (d.kind === "phase_renamed" && event.phase) {
        const phases = state.phases.map((p) =>
          p.status === "running" ? { ...p, name: event.phase as string } : p,
        );
        return { ...state, phases };
      }
      const activity =
        str(d.activity) ??
        (str(d.kind) && str(d.service)
          ? `${d.kind}: ${d.service}`
          : str(d.label));
      if (!activity) return state;
      const phases = state.phases.map((p) =>
        p.status === "running" && (event.phase === null || p.name === event.phase)
          ? { ...p, activity }
          : p,
      );
      return { ...state, phases };
    }
    case "note":
      return str(d.text)
        ? { ...state, notes: [...state.notes, d.text as string] }
        : state;
    case "warn":
      return str(d.text)
        ? { ...state, warnings: [...state.warnings, d.text as string] }
        : state;
    case "error":
      return {
        ...state,
        errors: [
          ...state.errors,
          {
            message: str(d.message) ?? "Bring-up failed",
            remediation: str(d.remediation),
            service: str(d.service),
            log: str(d.log),
          },
        ],
      };
    case "prompt_blocked":
      return {
        ...state,
        promptBlocked: {
          prompt: str(d.prompt) ?? "The launcher needs interactive input",
          remediation: str(d.remediation),
        },
      };
    case "ready":
      return {
        ...state,
        ready: {
          urls:
            typeof d.urls === "object" && d.urls !== null
              ? (d.urls as Record<string, string>)
              : {},
          hardware: str(d.hardware),
        },
      };
    default:
      // Unknown event types are non-breaking within v1 — ignore.
      return state;
  }
}

/** What the prompt-blocked card tells the user to run in a terminal. */
export const ONE_TIME_SETUP_COMMAND = "python run.py";

/**
 * The same command, aimed at the machine that actually runs it. A remote
 * bring-up happens on the far side of the SSH connection, so telling someone
 * to "run python run.py" without saying where sends them to the wrong shell.
 */
export function setupCommandFor(
  machine: { host?: string | null; user?: string | null; repoPath?: string | null } | null,
): string {
  if (!machine?.host) return ONE_TIME_SETUP_COMMAND;
  const target = machine.user ? `${machine.user}@${machine.host}` : machine.host;
  const path = machine.repoPath ?? "~/tt-studio";
  return `ssh ${target} -t 'cd ${path} && ${ONE_TIME_SETUP_COMMAND}'`;
}

/**
 * Fold the child's exit code into the state. A healthy stream carries its
 * own terminal event (ready / error / prompt_blocked); this fills the gap
 * when the process dies without one — a crash, a kill, or exit code 2 from
 * a prompt hit before the event stream existed — so the UI never waits on a
 * dead child. No-op when the stream already explained itself.
 */
export function applyExit(
  state: BringUpState,
  code: number | null,
  /** What the launcher said on stderr, when it said anything. */
  reason?: string | null,
): BringUpState {
  if (state.ready || code === 0) return state;
  // Empty-after-trim counts as "said nothing": `??` alone would let a
  // whitespace-only stderr through as a blank error message.
  const said = reason?.trim() || undefined;
  // Exit code 2 is the --json-events contract for "needed interactive input",
  // but Typer returns 2 for a usage error too. Only read it as a prompt when
  // the launcher actually got going: a run that produced no events and left a
  // message on stderr failed for the reason it gave, and reporting that as
  // "answer a prompt" sends the user looking for one that doesn't exist.
  const startedUp = state.phases.length > 0 || state.notes.length > 0;
  if (code === 2 && (startedUp || !said)) {
    return state.promptBlocked
      ? state
      : {
          ...state,
          promptBlocked: {
            prompt: "The launcher needed interactive input before it could report why.",
            remediation: ONE_TIME_SETUP_COMMAND,
          },
        };
  }
  if (state.errors.length > 0) return state;
  return {
    ...state,
    errors: [
      ...state.errors,
      {
        message:
          said ??
          (code === null
            ? "Bring-up was interrupted before it finished"
            : `Bring-up exited with code ${code}`),
        remediation: ONE_TIME_SETUP_COMMAND,
      },
    ],
  };
}

/** Convenience for tests and replay: fold a whole NDJSON document. */
export function reduceStream(ndjson: string): BringUpState {
  return ndjson
    .split("\n")
    .map(parseEventLine)
    .filter((e): e is BringUpEvent => e !== null)
    .reduce(reduceEvent, initialBringUpState());
}
