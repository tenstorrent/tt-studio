// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Client-side parsing + validation for training dataset preview. No backend is
// involved: the file is read in the browser, parsed, and a small sample is shown
// to the user before they wire it into a training job.

export type DatasetRow = Record<string, unknown>;

export interface DatasetPreview {
  /** All parsed rows (kept in memory for the preview only). */
  rows: DatasetRow[];
  /** Column keys, in first-seen order across the sampled rows. */
  columns: string[];
  /** Total number of rows in the file. */
  totalRows: number;
}

/** A parse failure with a user-facing message. */
export class DatasetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetParseError";
  }
}

// Only include object rows when deriving columns; scan at most this many rows so
// a very wide/long file does not stall the UI thread while building headers.
const MAX_ROWS_FOR_COLUMN_DERIVATION = 200;

function isPlainObject(value: unknown): value is DatasetRow {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Parse the text contents of a dataset file into a preview.
 *
 * Supported shape (per the current feature scope): a JSON array of objects,
 * e.g. `[{ "prompt": "...", "completion": "..." }, ...]`.
 *
 * Throws {@link DatasetParseError} with a friendly message for anything else.
 */
export function parseDatasetFile(text: string): DatasetPreview {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DatasetParseError("The file is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new DatasetParseError(`The file is not valid JSON: ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    throw new DatasetParseError(
      "Expected a JSON array of objects at the top level (e.g. [{ ... }, { ... }]).",
    );
  }

  if (parsed.length === 0) {
    throw new DatasetParseError("The dataset array is empty.");
  }

  const nonObjectIndex = parsed.findIndex((row) => !isPlainObject(row));
  if (nonObjectIndex !== -1) {
    throw new DatasetParseError(
      `Every item must be an object. Item at index ${nonObjectIndex} is not an object.`,
    );
  }

  const rows = parsed as DatasetRow[];
  const columns = deriveColumns(rows);

  return { rows, columns, totalRows: rows.length };
}

/** Collect column keys in first-seen order across the sampled rows. */
export function deriveColumns(rows: DatasetRow[]): string[] {
  const seen = new Set<string>();
  const limit = Math.min(rows.length, MAX_ROWS_FOR_COLUMN_DERIVATION);
  for (let i = 0; i < limit; i++) {
    for (const key of Object.keys(rows[i])) {
      seen.add(key);
    }
  }
  return Array.from(seen);
}

/**
 * Render a single cell value for the table view. Objects/arrays are stringified;
 * primitives are shown as-is; null/undefined render as an empty string.
 */
export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
