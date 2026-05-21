// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
//
// Metrics measurement approach adapted from the vLLM project (Apache-2.0):
// https://github.com/vllm-project/vllm/blob/main/vllm/benchmarks/lib/endpoint_request_func.py
// SPDX-FileCopyrightText: Copyright contributors to the vLLM project

/**
 * Metrics Tracker for Inference Performance
 *
 * Tracks TTFT, ITL, and TPOT following vLLM's measurement approach:
 * - TTFT: time from request start to first content chunk
 * - ITL: list of intervals between consecutive content chunks (ms)
 * - TPOT: mean of ITL
 * - Network latency: client_ttft - backend_ttft
 */

import type { TokenTimestamp, InferenceStats, ProgressiveStats, HardwareMetrics } from "./types";
import type { GpuBenchmark } from "./benchmarkData";

export class InferenceMetricsTracker {
  // Timing measurements
  private requestStartTime: number = 0;
  private firstTokenTime: number | undefined;
  private firstContentTokenTime: number | undefined; // first non-thinking token (true TTFT)
  private mostRecentTokenTime: number | undefined;   // vLLM-style: advances per content chunk
  private itl: number[] = [];                        // inter-token latencies in ms
  private tokenTimestamps: TokenTimestamp[] = [];

  // Token counters
  private lastTokenCount: number = 0;

  // Thinking/reasoning tracking
  private thinkingStartTime: number | undefined;
  private thinkingEndTime: number | undefined;
  private reasoningTokenCount: number = 0;

  constructor() {
    this.reset();
  }

  /**
   * Reset all metrics for a new inference request
   */
  reset(): void {
    this.requestStartTime = performance.now();
    this.firstTokenTime = undefined;
    this.firstContentTokenTime = undefined;
    this.mostRecentTokenTime = undefined;
    this.itl = [];
    this.tokenTimestamps = [];
    this.lastTokenCount = 0;
    this.thinkingStartTime = undefined;
    this.thinkingEndTime = undefined;
    this.reasoningTokenCount = 0;
  }

  /**
   * Record arrival of a thinking/reasoning chunk.
   * Does not affect ITL or TTFT — thinking time is tracked separately.
   */
  recordThinkingToken(): void {
    const now = performance.now();
    if (!this.thinkingStartTime) {
      this.thinkingStartTime = now;
      if (!this.firstTokenTime) this.firstTokenTime = now;
    }
    this.reasoningTokenCount++;
  }

  /**
   * Record arrival of a content chunk, tracking ITL exactly as vLLM does.
   * Call this once per content delta (text) as it arrives.
   */
  recordContentToken(): void {
    const now = performance.now();
    // Close thinking window on first content token
    if (this.thinkingStartTime && !this.thinkingEndTime) {
      this.thinkingEndTime = now;
    }
    if (!this.firstContentTokenTime) {
      this.firstContentTokenTime = now;
      if (!this.firstTokenTime) this.firstTokenTime = now;
      console.log(`[Metrics] First content token at ${(now - this.requestStartTime).toFixed(2)}ms`);
      // No ITL for first content token
    } else if (this.mostRecentTokenTime !== undefined) {
      this.itl.push(now - this.mostRecentTokenTime);
    }
    this.mostRecentTokenTime = now;
  }

  /**
   * @deprecated Use recordContentToken() for accurate ITL tracking.
   */
  recordFirstToken(): void {
    this.recordContentToken();
  }

  /**
   * Record usage data from a streaming chunk
   * @param usage - Usage object from streaming response containing token counts
   */
  recordUsage(usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }): void {
    const completionTokens = usage.completion_tokens || 0;

    // Only record if we have tokens and it's a new count
    if (completionTokens > 0 && completionTokens > this.lastTokenCount) {
      const timestamp = performance.now();

      this.tokenTimestamps.push({
        count: completionTokens,
        timestamp: timestamp,
        promptTokens: usage.prompt_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      });

      this.lastTokenCount = completionTokens;

      console.log(`[Metrics] Token #${completionTokens} at ${(timestamp - this.requestStartTime).toFixed(2)}ms`);
    }
  }

  /**
   * Calculate progressive statistics for live display
   * @returns Current progressive stats or null if no data available
   */
  getProgressiveStats(): ProgressiveStats | null {
    if (this.tokenTimestamps.length === 0) {
      return null;
    }

    const latestTimestamp = this.tokenTimestamps[this.tokenTimestamps.length - 1];
    const elapsedSeconds = (latestTimestamp.timestamp - this.requestStartTime) / 1000;
    const tokensGenerated = latestTimestamp.count;
    const tokensPerSecond = tokensGenerated / elapsedSeconds;

    return {
      tokensGenerated,
      tokensPerSecond,
      elapsedSeconds,
    };
  }

  /**
   * Finalize metrics and attach client-side measurements to backend stats.
   * @param backendStats - Stats received from backend
   * @returns Enhanced stats with client-side measurements
   */
  finalizeStats(backendStats: InferenceStats): InferenceStats {
    const enhancedStats = { ...backendStats };

    // Calculate client-side TTFT (use first CONTENT token for thinking models)
    const ttftAnchor = this.firstContentTokenTime ?? this.firstTokenTime;
    if (ttftAnchor) {
      const clientTtftMs = ttftAnchor - this.requestStartTime;
      const backendTtftMs = (backendStats.user_ttft_s || 0) * 1000;

      enhancedStats.client_ttft_ms = clientTtftMs;
      enhancedStats.network_latency_ms = Math.max(0, clientTtftMs - backendTtftMs);

      console.log(`[Metrics] Client TTFT: ${clientTtftMs.toFixed(2)}ms`);
      console.log(`[Metrics] Backend TTFT: ${backendTtftMs.toFixed(2)}ms`);
      console.log(`[Metrics] Network Latency: ${enhancedStats.network_latency_ms.toFixed(2)}ms`);
    }

    // Attach client-side ITL list (ms)
    if (this.itl.length > 0) {
      enhancedStats.itl = this.itl;
      console.log(`[Metrics] ITL samples: ${this.itl.length}, mean: ${(this.itl.reduce((a, b) => a + b, 0) / this.itl.length).toFixed(2)}ms`);
    }

    // Attach token timestamps for per-token analysis
    if (this.tokenTimestamps.length > 0) {
      enhancedStats.token_timestamps = this.tokenTimestamps;
      console.log(`[Metrics] Captured ${this.tokenTimestamps.length} token timestamps`);
    }

    // Attach thinking/reasoning metrics (client-measured)
    if (this.reasoningTokenCount > 0) {
      enhancedStats.reasoning_tokens = this.reasoningTokenCount;
    }
    if (this.thinkingStartTime && this.thinkingEndTime) {
      enhancedStats.thinking_duration_ms = this.thinkingEndTime - this.thinkingStartTime;
      console.log(`[Metrics] Thinking duration: ${enhancedStats.thinking_duration_ms.toFixed(0)}ms, reasoning tokens: ${this.reasoningTokenCount}`);
    }

    return enhancedStats;
  }

  /**
   * Get the request start time
   */
  getRequestStartTime(): number {
    return this.requestStartTime;
  }

  /**
   * Get all recorded token timestamps
   */
  getTokenTimestamps(): TokenTimestamp[] {
    return this.tokenTimestamps;
  }

  /**
   * Check if first token has been received
   */
  hasReceivedFirstToken(): boolean {
    return this.firstTokenTime !== undefined;
  }
}

/**
 * Compute efficiency comparison between TT hardware and GPU baselines.
 */
export interface EfficiencyComparison {
  gpu: string;
  gpu_tps: number;
  gpu_tps_per_watt: number;
  tt_tps: number;
  tt_tps_per_watt: number;
  speed_ratio: number;
  efficiency_ratio: number;
}

export function computeEfficiencyComparisons(
  stats: InferenceStats,
  baselines: GpuBenchmark[],
): EfficiencyComparison[] {
  const tps =
    stats.tps ??
    (typeof stats.user_tpot === "number" && stats.user_tpot > 0
      ? 1 / stats.user_tpot
      : undefined);
  const tpsPerWatt = stats.tps_per_watt;

  if (!tps || !tpsPerWatt) return [];

  return baselines.map((b) => ({
    gpu: b.gpu,
    gpu_tps: b.tps,
    gpu_tps_per_watt: b.tps_per_watt,
    tt_tps: tps,
    tt_tps_per_watt: tpsPerWatt,
    speed_ratio: Math.round((tps / b.tps) * 100) / 100,
    efficiency_ratio: Math.round((tpsPerWatt / b.tps_per_watt) * 10) / 10,
  }));
}
