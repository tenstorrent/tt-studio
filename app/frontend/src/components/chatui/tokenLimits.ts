// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface TokenLimits {
  defaultMaxTokens: number;
  sliderMax: number;
}

/**
 * Default ceiling for `max_tokens` so large-context models (e.g. 262k context
 * where 75% is 196,608 tokens) still have room for multi-thousand-token
 * reasoning traces without letting a looping model run for hours by default.
 * Users can still raise the slider up to `sliderMax`.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

/**
 * Character budget (~16k tokens) and line-repetition threshold for bounding
 * runaway reasoning loops during streaming.
 */
export const MAX_THINKING_CHARS = 65536;
export const MAX_REPEATED_THINKING_LINES = 5;
const MIN_REPEATED_LINE_LENGTH = 20;

export function getTokenLimitsForModel(
  paramCount: number | null | undefined,
  maxModelLen: number | null | undefined
): TokenLimits {
  const sliderMax =
    maxModelLen != null && maxModelLen > 0
      ? maxModelLen
      : paramCount == null || paramCount <= 8
        ? 32768
        : paramCount <= 32
          ? 65536
          : 131072;
  const contextCeiling = Math.max(1, Math.floor((sliderMax * 3) / 4));
  const defaultMaxTokens = Math.min(DEFAULT_MAX_OUTPUT_TOKENS, contextCeiling);
  return { defaultMaxTokens, sliderMax };
}

/**
 * Detects runaway thinking loops (either exceeding the thinking character budget
 * or repeating the same non-trivial reasoning line >= MAX_REPEATED_THINKING_LINES
 * times).
 */
export function isRunawayThinking(thinkingText: string): boolean {
  if (!thinkingText) {
    return false;
  }
  if (thinkingText.length > MAX_THINKING_CHARS) {
    return true;
  }
  const lines = thinkingText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= MIN_REPEATED_LINE_LENGTH);
  if (lines.length < MAX_REPEATED_THINKING_LINES) {
    return false;
  }
  const latestLine = lines[lines.length - 1];
  let occurrences = 0;
  for (const line of lines) {
    if (line === latestLine) {
      occurrences += 1;
      if (occurrences >= MAX_REPEATED_THINKING_LINES) {
        return true;
      }
    }
  }
  return false;
}
