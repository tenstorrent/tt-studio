// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Text cleanup for the voice agent. Assistant turns can carry template tokens,
// <think> blocks, and — when the Search Agent is driving — search progress
// markers, citation lines, and the occasional leaked tool call. None of that
// belongs in the transcript, and even less of it belongs in the TTS audio.

const LEAKED_TOOL_CALL_RE =
  /\{\s*"name"\s*:\s*"[^"]*(?:tavily|search)[^"]*"\s*,\s*"(?:parameters|arguments)"\s*:\s*\{[^}]*\}\s*\}/gi;

/**
 * Strip model/agent scaffolding from an assistant turn, leaving the answer.
 * Safe for display — keeps markdown intact.
 */
export function cleanLlmText(text: string): string {
  return text
    .replace(/[[<|]*python_tag[\]>|]*/gi, "")
    .replace(/<\|.*?\|>(&gt;)?/g, "")
    .replace(/\b(assistant|user)\b/gi, "")
    .replace(/\|(?:eot_id|start_header_id)\|/g, "")
    .replace(/<think>.*?<\/think>/gis, "")
    .replace(/<think>.*$/is, "")
    .replace(/<\/think>/gi, "")
    .replace(/&(lt|gt);/g, "")
    .replace(LEAKED_TOOL_CALL_RE, "")
    .replace(/\{\s*"name"\s*:\s*"[^"]*(?:tavily|search)[^"]*"[\s\S]*$/i, "")
    .replace(/^\s*\[searching\]\s*$/gim, "")
    .replace(/^\s*Searching:.*$/gim, "")
    .replace(/Source:\s*\[[^\]]*\]\([^)]+\)\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Everything `cleanLlmText` removes, plus the markdown and URLs that a TTS
 * engine would otherwise read out character by character. Display text keeps
 * its formatting; only the spoken string goes through this.
 */
export function cleanSpeechText(text: string): string {
  return (
    cleanLlmText(text)
      // Fenced and inline code — speak the code, not the backticks.
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/`([^`]*)`/g, "$1")
      // Links: keep the label, drop the target.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Bare URLs read terribly aloud.
      .replace(/\bhttps?:\/\/\S+/gi, "")
      .replace(/\bwww\.\S+/gi, "")
      // Emphasis, headings, list bullets, block quotes, table pipes.
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*\|.*\|\s*$/gm, "")
      .replace(/^\s*[-=]{3,}\s*$/gm, "")
      // Bracketed citation markers such as [1] or [source 2].
      .replace(/\[[^\]]{1,24}\]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export interface SearchProgress {
  /** The agent has started searching (query may not have arrived yet). */
  isSearching: boolean;
  /** Search queries the agent reported, most recent last. */
  queries: string[];
}

/**
 * Read the Search Agent's progress markers out of a partial stream.
 *
 * The agent emits `[searching]` when it starts and `Searching: <query>` once it
 * has a query; both are stripped from the visible answer by `cleanLlmText`, so
 * this is the only place they are read.
 */
export function parseSearchProgress(text: string): SearchProgress {
  const queries: string[] = [];
  const searchRegex = /Searching:\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = searchRegex.exec(text)) !== null) {
    const query = match[1].trim();
    if (query) queries.push(query);
  }

  return {
    isSearching: queries.length > 0 || /\[searching\]/i.test(text),
    queries,
  };
}

/** True once the stream carries answer text rather than only search markers. */
export function hasAnswerContent(text: string): boolean {
  return cleanLlmText(text).length > 0;
}
