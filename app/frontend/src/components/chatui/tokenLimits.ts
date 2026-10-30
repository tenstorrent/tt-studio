// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface TokenLimits {
  defaultMaxTokens: number;
  sliderMax: number;
}

/**
 * Returns default max_tokens and UI slider max.
 *
 * Uses max_model_len (actual context window from the running vLLM container) when
 * available — this is the authoritative value. Falls back to a param_count-based
 * estimate when the container hasn't been queried yet.
 *
 * The default is the model's full usable output budget rather than a small
 * fraction of it: reasoning models spend thousands of tokens thinking before
 * they answer, and a low default cuts them off mid-response. The backend clamps
 * max_tokens to 75% of the context window to leave room for the prompt, so the
 * default mirrors that ceiling and the slider spans the whole context.
 */
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
  const defaultMaxTokens = Math.max(1, Math.floor((sliderMax * 3) / 4));
  return { defaultMaxTokens, sliderMax };
}
