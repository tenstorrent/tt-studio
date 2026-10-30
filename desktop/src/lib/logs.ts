// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Level classification and filtering for the logs viewer. NDJSON streams
// (bringup.ndjson & friends) carry the --json-events envelope, so each line
// gets a level from its event type; plain stderr logs have no structure and
// every line reads as "info".

import { parseEventLine } from "./events";

export type LogLevel = "info" | "warn" | "error";

export interface LogLine {
  raw: string;
  level: LogLevel;
  /** Short human rendering for NDJSON events; raw text otherwise. */
  text: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/** Classify one NDJSON line. Unparseable lines pass through as info. */
export function classifyNdjsonLine(raw: string): LogLine {
  const event = parseEventLine(raw);
  if (!event) return { raw, level: "info", text: raw };
  const d = event.detail;
  switch (event.event) {
    case "error":
      return {
        raw,
        level: "error",
        text: `error: ${str(d.message) ?? raw}`,
      };
    case "prompt_blocked":
      return {
        raw,
        level: "error",
        text: `blocked: ${str(d.prompt) ?? raw}`,
      };
    case "warn":
      return { raw, level: "warn", text: `warn: ${str(d.text) ?? raw}` };
    case "note":
      return { raw, level: "info", text: str(d.text) ?? raw };
    case "phase_begin":
      return { raw, level: "info", text: `▶ ${event.phase ?? "phase"}` };
    case "phase_end":
      return {
        raw,
        level: d.status === "ok" ? "info" : "error",
        text: `${d.status === "ok" ? "✓" : "✗"} ${event.phase ?? "phase"}`,
      };
    case "ready":
      return { raw, level: "info", text: "✓ stack ready" };
    default:
      return { raw, level: "info", text: raw };
  }
}

/** Split a log document into classified lines. */
export function classifyLog(content: string, ndjson: boolean): LogLine[] {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((raw) =>
    ndjson ? classifyNdjsonLine(raw) : { raw, level: "info" as const, text: raw },
  );
}

const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

/** Keep lines at or above the selected minimum level. */
export function filterByLevel(lines: LogLine[], min: LogLevel): LogLine[] {
  return lines.filter((l) => RANK[l.level] >= RANK[min]);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
