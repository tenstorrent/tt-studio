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
  /** True when the preview was built from a sampled slice, not the whole file. */
  sampled?: boolean;
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

// Pull the record list out of a { rows|data: [...] } wrapper, including the HF
// datasets-server envelope. Returns null if there is no such list.
function extractRowsFromEnvelope(value: unknown): unknown[] | null {
  if (!isPlainObject(value)) return null;
  const container = Array.isArray(value.rows)
    ? (value.rows as unknown[])
    : Array.isArray(value.data)
      ? (value.data as unknown[])
      : null;
  if (!container) return null;
  // HF wraps each record as { row_idx, row: {...} }; unwrap it.
  return container.map((item) =>
    isPlainObject(item) && isPlainObject((item as DatasetRow).row)
      ? (item as DatasetRow).row
      : item,
  );
}

// Parse JSON Lines (one object per line). Returns null if invalid.
function parseJsonl(trimmed: string): unknown[] | null {
  const rows: unknown[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isPlainObject(obj)) return null;
    rows.push(obj);
  }
  return rows.length > 0 ? rows : null;
}

// Turn the raw file text into a flat list of record candidates (see
// parseDatasetFile for the accepted shapes).
function extractRows(trimmed: string): unknown[] {
  let parsed: unknown;
  let jsonError: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    jsonError = err;
  }

  if (jsonError === undefined) {
    if (Array.isArray(parsed)) return parsed;
    const unwrapped = extractRowsFromEnvelope(parsed);
    if (unwrapped) return unwrapped;
    throw new DatasetParseError(
      "Expected a JSON array of objects (e.g. [{ ... }, { ... }]), a JSON Lines " +
        'file (one object per line), or a Hugging Face datasets export with a "rows" array.',
    );
  }

  // Not a single JSON value; try JSON Lines.
  const jsonl = parseJsonl(trimmed);
  if (jsonl) return jsonl;

  const detail = jsonError instanceof Error ? jsonError.message : String(jsonError);
  throw new DatasetParseError(`The file is not valid JSON or JSON Lines: ${detail}`);
}

/**
 * Parse the text contents of a dataset file into a preview.
 *
 * Accepts, all normalized to a flat list of object rows:
 *  - a JSON array of objects, e.g. `[{ "prompt": "...", "completion": "..." }, ...]`
 *  - a `{ "rows"|"data": [ ... ] }` wrapper (incl. HF datasets exports)
 *  - JSON Lines (one JSON object per line)
 *
 * Throws {@link DatasetParseError} with a friendly message for anything else.
 */
export function parseDatasetFile(text: string): DatasetPreview {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DatasetParseError("The file is empty.");
  }

  const rawRows = extractRows(trimmed);

  if (rawRows.length === 0) {
    throw new DatasetParseError("The dataset is empty.");
  }

  const nonObjectIndex = rawRows.findIndex((row) => !isPlainObject(row));
  if (nonObjectIndex !== -1) {
    throw new DatasetParseError(
      `Every item must be an object. Item at index ${nonObjectIndex} is not an object.`,
    );
  }

  const rows = rawRows as DatasetRow[];
  const columns = deriveColumns(rows);

  return { rows, columns, totalRows: rows.length };
}

/**
 * Extract up to `maxRows` complete record objects from a leading (possibly
 * truncated) chunk of a large file, for a sampled preview. Scans for balanced
 * top-level `{ ... }` objects, honoring string/escape state, so it handles both
 * a JSON array and JSON Lines. A trailing partial record is ignored; returns
 * `[]` when nothing complete can be extracted.
 */
export function extractSampleRows(chunk: string, maxRows: number): DatasetRow[] {
  const rows: DatasetRow[] = [];
  const n = chunk.length;
  let i = 0;

  while (i < n && rows.length < maxRows) {
    while (i < n && chunk[i] !== "{") i++;
    if (i >= n) break;

    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (; i < n; i++) {
      const ch = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          i++;
          break;
        }
      }
    }

    // Truncated trailing record; stop.
    if (end === -1) break;

    try {
      const obj = JSON.parse(chunk.slice(start, end));
      if (isPlainObject(obj)) rows.push(obj);
    } catch {
      break;
    }
  }

  return rows;
}

/** Build a sampled {@link DatasetPreview} from a leading slice of a large file. */
export function buildSampledPreview(chunk: string, maxRows = 50): DatasetPreview {
  const rows = extractSampleRows(chunk, maxRows);
  const columns = deriveColumns(rows);
  return { rows, columns, totalRows: rows.length, sampled: true };
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
