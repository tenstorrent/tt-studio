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
 */
export function getTokenLimitsForModel(
  paramCount: number | null | undefined,
  maxModelLen: number | null | undefined
): TokenLimits {
  // Slider max is capped at a sensible response length — the context window
  // is the total input+output budget, not a realistic single-response target.
  if (maxModelLen != null && maxModelLen > 0) {
    const sliderMax = maxModelLen <= 16384 ? 8192
                    : maxModelLen <= 65536 ? 16384
                    : 32768;
    const defaultMaxTokens = Math.min(Math.round(sliderMax / 4), 8192);
    return { defaultMaxTokens, sliderMax };
  }

  // Fallback: estimate from param_count
  if (paramCount == null) return { defaultMaxTokens: 1024, sliderMax: 8192 };
  if (paramCount <= 8)    return { defaultMaxTokens: 2048, sliderMax: 8192 };
  if (paramCount <= 32)   return { defaultMaxTokens: 4096, sliderMax: 16384 };
  return                         { defaultMaxTokens: 8192, sliderMax: 32768 };
}
