// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Shared Tailwind class strings. Not components — the views stay plain JSX
// and keep hand-rolling anything one-off; these only collapse the strings
// that were already duplicated verbatim across screens, so a new screen
// looks like the old ones by default.
//
// Every interactive constant carries a focus-visible ring: keyboard focus
// was invisible everywhere before these existed.

const RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

/** The one primary action on a screen. Purple; sky stays update-only. */
export const btnPrimary = `rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50 ${RING}`;

/** Everything alongside a primary: outlined, neutral. */
export const btnSecondary = `rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-50 ${RING}`;

/** Bare text button — "Cancel", footer links. */
export const btnTertiary = `rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300 ${RING}`;

/** Centered single-column page. Width is per-screen; max-w-md is the norm. */
export const shell =
  "flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100";

/** Neutral surface: list rows, panels. */
export const card = "rounded-lg border border-zinc-800 bg-zinc-900";

/** Failure surface. Its heading is text-red-300, body text-red-200/80. */
export const errorCard = "rounded-lg border border-red-900 bg-red-950/40";

export const field = `w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-purple-500 ${RING}`;

export const fieldLabel = "block text-xs font-medium text-zinc-400";

export const select = `rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 ${RING}`;

/** Streamed subprocess output. Callers add their own max-h-*. */
export const logPre =
  "w-full overflow-y-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300";
