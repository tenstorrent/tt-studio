// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Pure wording for session state: how long a connection has been up, and
// what the quit dialog says about the stack it is about to leave behind.
// No IPC here.

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
