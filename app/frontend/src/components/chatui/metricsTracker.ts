// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Metrics Tracker for Inference Performance
 *
 * This module provides a clean, structured way to track and measure
 * inference performance metrics including:
 * - Client-side TTFT (Time to First Token)
 * - Per-token timing measurements
 * - Network latency calculations
 * - Progressive statistics during streaming
 */

import type { TokenTimestamp, InferenceStats, ProgressiveStats } from "./types";

export class InferenceMetricsTracker {
  // Timing measurements
  private requestStartTime: number = 0;
  private firstTokenTime: number | undefined;
  private tokenTimestamps: TokenTimestamp[] = [];

  // Token counters
  private lastTokenCount: number = 0;

  constructor() {
    this.reset();
  }

  /**
   * Reset all metrics for a new inference request
   */
  reset(): void {
    this.requestStartTime = performance.now();
    this.firstTokenTime = undefined;
    this.tokenTimestamps = [];
    this.lastTokenCount = 0;
  }

  /**
   * Record that the first content token has been received
   */
  recordFirstToken(): void {
    if (!this.firstTokenTime) {
      this.firstTokenTime = performance.now();
      console.log(`[Metrics] First token at ${(this.firstTokenTime - this.requestStartTime).toFixed(2)}ms`);
    }
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
   * Finalize metrics and attach client-side measurements to backend stats
   * @param backendStats - Stats received from backend
   * @returns Enhanced stats with client-side measurements
   */
  finalizeStats(backendStats: InferenceStats): InferenceStats {
    const enhancedStats = { ...backendStats };

    // Calculate client-side TTFT
    if (this.firstTokenTime) {
      const clientTtftMs = this.firstTokenTime - this.requestStartTime;
      const backendTtftMs = (backendStats.user_ttft_s || 0) * 1000;

      enhancedStats.client_ttft_ms = clientTtftMs;
      enhancedStats.network_latency_ms = Math.max(0, clientTtftMs - backendTtftMs);

      console.log(`[Metrics] Client TTFT: ${clientTtftMs.toFixed(2)}ms`);
      console.log(`[Metrics] Backend TTFT: ${backendTtftMs.toFixed(2)}ms`);
      console.log(`[Metrics] Network Latency: ${enhancedStats.network_latency_ms.toFixed(2)}ms`);
    }

    // Attach token timestamps for per-token analysis
    if (this.tokenTimestamps.length > 0) {
      enhancedStats.token_timestamps = this.tokenTimestamps;
      console.log(`[Metrics] Captured ${this.tokenTimestamps.length} token timestamps`);
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
