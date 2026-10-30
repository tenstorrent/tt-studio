// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Pure wording for session state: how long a connection has been up, what
// the quit dialog says about the stack it is about to leave behind, and why
// an automatic resume gave up. No IPC here.

import type { BlockedPort } from "./connect";
import type { ClearReport, StackClassification } from "./ipc";

/**
 * A session duration in words: "just now", "14m", "2h 14m", "3 days".
 * Null for anything we can't state honestly (unknown or nonsense input) —
 * the caller renders nothing rather than "NaN".
 */
export function describeSessionAge(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

/** "Connected to QuietBox for 2h 14m." — the quit dialog's context line. */
export function describeSession(
  machine: string | null,
  age: string | null,
): string | null {
  if (!machine) return null;
  if (!age) return `Connected to ${machine}.`;
  if (age === "just now") return `Connected to ${machine} a moment ago.`;
  return `Connected to ${machine} for ${age}.`;
}

/**
 * Why a resume stopped short, for the picker's notice line. Always names the
 * machine and says what the user can do: a resume that just vanishes reads
 * like the app forgot the machine.
 */
export function resumeNotReadyNotice(
  machine: string,
  classification: StackClassification,
): string {
  const tail = `Pick ${machine} to start it.`;
  switch (classification.kind) {
    case "down":
      return `The stack on ${machine} isn't running any more. ${tail}`;
    case "partial":
      return `The stack on ${machine} is only partly up (${classification.unhealthy.join(", ")}). ${tail}`;
    case "no_checkout":
      return `TT-Studio is no longer set up at ${classification.path} on ${machine}.`;
    case "python_missing":
      return `${machine} no longer has a usable python3, so the stack can't be started there.`;
    case "python_too_old":
      return `${machine} has Python ${classification.found}; ${classification.required} or newer is needed.`;
    default:
      return `Couldn't pick up the session on ${machine}. ${tail}`;
  }
}

/** A resume abandoned because local ports the tunnel needs were taken. */
export function resumeBlockedNotice(
  machine: string,
  blocked: BlockedPort[],
): string {
  const ports = blocked.map((b) => b.port).join(", ");
  return (
    `Didn't reconnect to ${machine}: port${blocked.length > 1 ? "s" : ""} ` +
    `${ports} on this computer ${blocked.length > 1 ? "are" : "is"} in use. ` +
    `Pick ${machine} to see what's holding ${blocked.length > 1 ? "them" : "it"}.`
  );
}

/** A resume abandoned because the port pre-flight couldn't clear the way. */
export function portClearNotice(report: ClearReport): string {
  const ports = report.skipped.map((s) => s.port);
  const named = report.skipped
    .map((s) => s.holder?.name)
    .filter((n): n is string => Boolean(n));
  const by = named.length ? ` (held by ${[...new Set(named)].join(", ")})` : "";
  return (
    `Didn't reconnect: port${ports.length > 1 ? "s" : ""} ${ports.join(", ")} ` +
    `on this computer ${ports.length > 1 ? "are" : "is"} in use${by}. ` +
    "Connect from the list to see the details."
  );
}
