// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface ParsedCanvasResponse {
  explanation: string;
  code: string | null;
}

const HTML_FENCE_REGEX = /```html\s*\n([\s\S]*?)```/;
const GENERIC_FENCE_REGEX = /```\s*\n([\s\S]*?)```/;
const HTML_DOC_REGEX = /(<!DOCTYPE html[\s\S]*<\/html>)/i;
const HTML_TAG_REGEX = /(<html[\s\S]*<\/html>)/i;

export function parseCanvasResponse(text: string): ParsedCanvasResponse {
  // Try ```html fenced block first (most reliable)
  let match = HTML_FENCE_REGEX.exec(text);
  if (match) {
    const code = match[1].trim();
    const explanation = text.slice(0, match.index).trim();
    return { explanation, code };
  }

  // Try generic ``` block containing HTML
  match = GENERIC_FENCE_REGEX.exec(text);
  if (match) {
    const candidate = match[1].trim();
    if (
      candidate.includes("<html") ||
      candidate.includes("<!DOCTYPE") ||
      candidate.includes("<body")
    ) {
      const explanation = text.slice(0, match.index).trim();
      return { explanation, code: candidate };
    }
  }

  // Try to find a raw HTML document
  match = HTML_DOC_REGEX.exec(text) || HTML_TAG_REGEX.exec(text);
  if (match) {
    const explanation = text.slice(0, match.index).trim();
    return { explanation, code: match[1].trim() };
  }

  return { explanation: text.trim(), code: null };
}

/**
 * Incrementally parse streaming text. Returns the latest code if a complete
 * fenced block is found, otherwise returns null (still streaming).
 */
export function parseStreamingCode(text: string): string | null {
  const match = HTML_FENCE_REGEX.exec(text);
  if (match) return match[1].trim();

  const generic = GENERIC_FENCE_REGEX.exec(text);
  if (generic) {
    const candidate = generic[1].trim();
    if (
      candidate.includes("<html") ||
      candidate.includes("<!DOCTYPE") ||
      candidate.includes("<body")
    ) {
      return candidate;
    }
  }

  return null;
}
