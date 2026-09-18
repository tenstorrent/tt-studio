// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/*
 * Client for POST /models-api/ocr/.
 *
 * One image per request. The endpoint accepts a batch, but it processes images
 * serially with a 900s upstream read timeout each, while nginx caps a single
 * request at 1200s -- so a multi-image request would hit the proxy limit and
 * return nginx's own 504 instead of the view's partial-result body, losing
 * every page that had already succeeded. Sending them one at a time keeps each
 * request well inside the limit and makes progress, retry and cancel per-image.
 *
 * Nothing here throws: callers get a discriminated result instead, because the
 * caller has to distinguish "this image failed" from "the endpoint is down" to
 * decide whether to keep going.
 */

const OCR_ENDPOINT = "/models-api/ocr/";

/** Must match views.OCR_PAGE_SEPARATOR -- the client joins pages itself. */
export const OCR_PAGE_SEPARATOR = "\n\n---\n\n";

export const OCR_ACCEPT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
];

/** Bounds worst-case wall time: 20 images x 900s is already a long wait. */
export const OCR_MAX_IMAGES = 20;

export const OCR_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Just past the server's own 900s per-image read timeout. */
export const OCR_TIMEOUT_MS = 960_000;

export interface OcrPageResult {
  index: number;
  filename: string;
  text?: string;
  finish_reason?: string | null;
  usage?: Record<string, number> | null;
  /** Strips the server read the page in; >1 explains a slower read. */
  tiles?: number;
  error?: string;
}

export interface OcrRequestResult {
  ok: boolean;
  /** Cancelled by the caller or timed out; not a server failure. */
  aborted: boolean;
  status: number;
  /** Parsed whether or not the response was ok -- see requestOcr. */
  pages: OcrPageResult[];
  error: string | null;
}

interface OcrRequestOptions {
  deployId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePages(data: unknown): OcrPageResult[] {
  if (!isRecord(data) || !Array.isArray(data.pages)) return [];
  return data.pages.filter(isRecord) as unknown as OcrPageResult[];
}

function parseError(data: unknown, body: string, status: number): string {
  if (isRecord(data)) {
    const detail = data.error ?? data.detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return body.slice(0, 300) || `HTTP ${status}`;
}

/**
 * Read text from one image.
 *
 * `pages` is parsed before `response.ok` is consulted. The load-bearing case is
 * an image the server cannot decode: that comes back 200 with the reason inside
 * pages[0].error and no text, so a caller that only looked at the status would
 * report success and show an empty page. The view also returns
 * {"error": ..., "pages": <completed>} on a 502/504, which is what made a
 * batched request recoverable; one image per request means that array is empty
 * here, and the top-level error carries the message instead.
 */
export async function requestOcr(
  files: File[],
  options: OcrRequestOptions = {},
): Promise<OcrRequestResult> {
  const { deployId, signal, timeoutMs = OCR_TIMEOUT_MS } = options;

  const formData = new FormData();
  files.forEach((file) => formData.append("images", file, file.name));
  // Omitting deploy_id is what selects CLOUD_OCR_URL on the server.
  if (deployId) formData.append("deploy_id", deployId);
  // prompt and max_tokens are left off so the server's defaults apply.

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);

  try {
    const response = await fetch(OCR_ENDPOINT, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    const body = await response.text();
    let data: unknown = null;
    try {
      data = JSON.parse(body);
    } catch {
      data = null;
    }

    return {
      ok: response.ok,
      aborted: false,
      status: response.status,
      pages: parsePages(data),
      error: response.ok ? null : parseError(data, body, response.status),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, aborted: true, status: 0, pages: [], error: null };
    }
    const message =
      error instanceof Error ? error.message : "The OCR request failed.";
    return { ok: false, aborted: false, status: 0, pages: [], error: message };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
