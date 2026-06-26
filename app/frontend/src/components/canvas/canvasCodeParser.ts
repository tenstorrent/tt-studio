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

  // Fallback: look for raw HTML document without fences (common in edit responses)
  const docMatch = HTML_DOC_REGEX.exec(text) || HTML_TAG_REGEX.exec(text);
  if (docMatch) return docMatch[1].trim();

  return null;
}

/**
 * Extract code-in-progress from a partially-streamed response. Unlike
 * parseStreamingCode this does NOT require a closing ``` fence, so callers
 * can show the code growing as it arrives.
 */
export function parseStreamingCodePartial(text: string): string | null {
  // Opening ```html fence — everything after it up to a closing fence (or end).
  const htmlFenceIdx = text.indexOf("```html");
  if (htmlFenceIdx >= 0) {
    const afterTag = text.slice(htmlFenceIdx + "```html".length);
    const newlineIdx = afterTag.indexOf("\n");
    const body = newlineIdx >= 0 ? afterTag.slice(newlineIdx + 1) : "";
    const closeIdx = body.indexOf("```");
    return closeIdx >= 0 ? body.slice(0, closeIdx).trimEnd() : body;
  }

  // Raw HTML doc start (no fence — common for edit responses).
  const docMatch = /(<!DOCTYPE html|<html\b)/i.exec(text);
  if (docMatch) {
    return text.slice(docMatch.index);
  }

  // Generic ``` fence containing HTML-ish content.
  const genericFenceMatch = /```\s*\n/.exec(text);
  if (genericFenceMatch) {
    const body = text.slice(
      genericFenceMatch.index + genericFenceMatch[0].length,
    );
    if (
      body.includes("<html") ||
      body.includes("<!DOCTYPE") ||
      body.includes("<body")
    ) {
      const closeIdx = body.indexOf("```");
      return closeIdx >= 0 ? body.slice(0, closeIdx).trimEnd() : body;
    }
  }

  return null;
}
