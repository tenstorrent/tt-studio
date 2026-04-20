// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { useState } from "react";
import {
  BarChart2,
  Clock,
  Zap,
  Hash,
  Activity,
  Timer,
  Cpu,
  Thermometer,
  Gauge,
  Leaf,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useTheme } from "../../hooks/useTheme"; // Import the existing theme provider
import type { InferenceStatsProps, TokenTimestamp } from "./types";
import { getModelBenchmarks } from "./benchmarkData";
import { computeEfficiencyComparisons } from "./metricsTracker";
import type { EfficiencyComparison } from "./metricsTracker";

interface InferenceStatsComponentProps extends InferenceStatsProps {
  inline?: boolean;
}

interface TokenTimingStats {
  median: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

function calculateTokenTimingStats(timestamps: TokenTimestamp[]): TokenTimingStats | null {
  if (timestamps.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const deltaTokens = timestamps[i].count - timestamps[i-1].count;
    const deltaTime = timestamps[i].timestamp - timestamps[i-1].timestamp;
    if (deltaTokens > 0) {
      // Calculate per-token time
      intervals.push(deltaTime / deltaTokens);
    }
  }

  if (intervals.length === 0) return null;

  // Sort for percentile calculations
  intervals.sort((a, b) => a - b);

  const median = intervals[Math.floor(intervals.length / 2)];
  const p95 = intervals[Math.floor(intervals.length * 0.95)];
  const p99 = intervals[Math.floor(intervals.length * 0.99)];
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const min = intervals[0];
  const max = intervals[intervals.length - 1];

  return { median, p95, p99, mean, min, max };
}

export default function Component({
  stats,
  modelName,
  inline = false,
}: InferenceStatsComponentProps) {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme(); // Use your existing theme hook

  // Determine dark mode based on the theme value
  const isDarkMode = theme === "dark";

  // Check if we're in deployed mode or AI playground mode
  const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

  if (!stats) return null;

  // Always display time values in ms (input expected in seconds)
  const formatValue = (value: number | undefined) => {
    if (typeof value !== "number")
      return { value: "N/A", unit: "", isSmall: true };
    return {
      value: Math.round(value * 1000).toString(),
      unit: "ms",
      isSmall: true,
    };
  };

  const userTPS =
    typeof stats.user_tpot === "number"
      ? (1 / Math.max(stats.user_tpot, 0.000001)).toFixed(2)
      : "N/A";

  // Define the stat item type to include isSmall property
  type StatItem = {
    icon: React.ReactNode;
    value: string | number;
    unit: string;
    label: string;
    isSmall?: boolean;
  };

  // Calculate token timing stats if available
  const tokenTimingStats = stats.token_timestamps
    ? calculateTokenTimingStats(stats.token_timestamps)
    : null;

  const sections = [
    {
      title: "Time Metrics",
      stats: [
        {
          icon: (
            <Clock
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          ...formatValue(stats.user_ttft_s),
          label: "Backend TTFT",
        } as StatItem,
        {
          icon: (
            <Timer
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.client_ttft_ms ? Math.round(stats.client_ttft_ms).toString() : "N/A",
          label: "Client TTFT",
          unit: stats.client_ttft_ms ? "ms" : "",
          isSmall: true,
        } as StatItem,
      ],
    },
    {
      title: "Throughput Metrics",
      stats: [
        {
          icon: (
            <Zap
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          ...formatValue(stats.user_tpot),
          label: "Time Per Output Token",
        } as StatItem,
        {
          icon: (
            <Activity
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: userTPS,
          label: "Tokens Per Second",
          unit: "tok/s",
          isSmall: false,
        } as StatItem,
        ...(tokenTimingStats ? [{
          icon: (
            <Activity
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: tokenTimingStats.median.toFixed(1),
          label: "Median Token Time",
          unit: "ms",
          isSmall: false,
        } as StatItem] : []),
      ],
    },
  ];

  // Function to get the display model name
  const getDisplayModelName = () => {
    // Always use modelName if provided, regardless of mode
    if (modelName) {
      return modelName;
    }
    
    // Only use mode-specific fallbacks when modelName is not available
    if (apiUrlDefined) {
      return "Unknown Model";
    } else {
      return "Tenstorrent/Meta-Llama 3.3 70B";
    }
  };

  // --- Derived values for bar visualization ---
  const ttftMs: number | null =
    stats.client_ttft_ms != null
      ? stats.client_ttft_ms
      : stats.user_ttft_s != null
        ? stats.user_ttft_s * 1000
        : null;
  const totalMs: number | null = stats.timing?.total ?? null;
  const generationMs: number | null =
    ttftMs != null && totalMs != null
      ? Math.max(0, totalMs - ttftMs)
      : stats.user_tpot != null && stats.tokens_decoded != null
        ? stats.user_tpot * stats.tokens_decoded * 1000
        : null;
  const displayTotalMs: number | null =
    totalMs ?? (ttftMs != null && generationMs != null ? ttftMs + generationMs : null);
  // 3-segment bar when thinking data is present
  const thinkingMs: number | null = stats.thinking_duration_ms ?? null;
  const hasThinkingData = thinkingMs != null && thinkingMs > 0;

  // For thinking models, ttftMs is the pre-thinking wait time (request → first thinking token)
  // thinkingMs is thinking duration, generationMs is content generation
  // For non-thinking models: just ttftPct + genPct
  const ttftPct =
    ttftMs != null && displayTotalMs != null && displayTotalMs > 0
      ? Math.max(3, Math.min(hasThinkingData ? 20 : 95, Math.round((ttftMs / displayTotalMs) * 100)))
      : 20;
  const thinkingPct =
    hasThinkingData && displayTotalMs != null && displayTotalMs > 0
      ? Math.max(5, Math.min(80, Math.round((thinkingMs! / displayTotalMs) * 100)))
      : 0;
  const genPct = Math.max(5, 100 - ttftPct - thinkingPct);

  const fmtMs = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

  // True when the backend returned real per-token metrics (non-agent flow).
  // When false we hide the bar, stat-card sections, and per-token timing
  // because they'd be all N/A or misleading.
  const hasServerMetrics =
    stats.user_ttft_s != null ||
    stats.user_tpot != null ||
    (stats.tokens_decoded != null && stats.tokens_decoded > 0);

  // --- Hardware & efficiency data ---
  const hw = stats.hardware;
  const gpuBaselines = getModelBenchmarks(modelName);
  const efficiencyComparisons: EfficiencyComparison[] =
    gpuBaselines ? computeEfficiencyComparisons(stats, gpuBaselines) : [];
  const bestEfficiencyRatio =
    efficiencyComparisons.length > 0
      ? Math.max(...efficiencyComparisons.map((c) => c.efficiency_ratio))
      : null;

  const ttTps =
    stats.tps ??
    (typeof stats.user_tpot === "number" && stats.user_tpot > 0
      ? 1 / stats.user_tpot
      : undefined);

  // Reusable stats display component
  const StatsDisplay = ({ className = "" }: { className?: string }) => (
    <div className={`space-y-4 sm:space-y-6 ${className}`}>

      {/* ── Bar + summary (only for direct LLM inference, not agent) ── */}
      {hasServerMetrics && ttftMs != null && generationMs != null && (
        <div className="space-y-1.5">
          {/* Legend */}
          <div className={`flex items-center gap-3 text-xs ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
            <span className="flex items-center gap-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"}`} />
              TTFT
            </span>
            {hasThinkingData && (
              <span className="flex items-center gap-1">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent/65" : "bg-violet-400"}`} />
                Reasoning
              </span>
            )}
            <span className="flex items-center gap-1 ml-auto">
              Generation
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent/30" : "bg-violet-200"}`} />
            </span>
          </div>

          {/* Bar */}
          <div className="flex h-7 w-full overflow-hidden rounded-md text-xs font-medium">
            <div
              className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"} text-white`}
              style={{ width: `${ttftPct}%` }}
            >
              {ttftPct > 12 && fmtMs(ttftMs)}
            </div>
            {hasThinkingData && (
              <div
                className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent/65" : "bg-violet-400"} text-white`}
                style={{ width: `${thinkingPct}%` }}
              >
                {thinkingPct > 12 && fmtMs(thinkingMs!)}
              </div>
            )}
            <div
              className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent/30" : "bg-violet-200"} ${isDarkMode ? "text-white/70" : "text-violet-900"}`}
              style={{ width: `${genPct}%` }}
            >
              {genPct > 12 && generationMs != null && fmtMs(generationMs)}
            </div>
          </div>

          {/* Axis labels */}
          <div className={`flex justify-between text-xs ${isDarkMode ? "text-white/30" : "text-gray-400"}`}>
            <span>request start</span>
            <span>token generation</span>
          </div>

          {/* Compact key-value rows */}
          <div className={`mt-1 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"} pt-1.5 space-y-0`}>
            {[
              { label: "TTFT (to first content token)", value: fmtMs(ttftMs) },
              hasThinkingData ? { label: "Reasoning duration",             value: fmtMs(thinkingMs!) } : null,
              hasThinkingData && stats.reasoning_tokens ? { label: "Reasoning tokens",              value: String(stats.reasoning_tokens) } : null,
              generationMs != null ? { label: "Generation time",           value: fmtMs(generationMs) } : null,
              { label: "Throughput (estimated)",        value: userTPS !== "N/A" ? `${userTPS} t/s` : null },
              { label: "Tokens",                        value: stats.tokens_decoded ? (stats.tokens_prefilled ? `${stats.tokens_prefilled} in / ${stats.tokens_decoded} out` : `${stats.tokens_decoded} out`) : null },
            ]
              .filter((r): r is { label: string; value: string | null } => r != null && r.value != null)
              .map((row, idx) => (
                <div key={idx} className={`flex justify-between py-1 text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"}`}>
                  <span>{row.label}</span>
                  <span className={isDarkMode ? "text-white/90" : "text-gray-800"}>{row.value}</span>
                </div>
              ))}
            {displayTotalMs != null && (
              <div className={`flex justify-between py-1 text-xs font-semibold border-t mt-0.5 ${isDarkMode ? "border-zinc-800 text-white" : "border-gray-200 text-gray-900"}`}>
                <span>Total stream duration</span>
                <span>{fmtMs(displayTotalMs)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Agent / Search timing summary ── */}
      {!hasServerMetrics && (stats.thinking_duration_ms != null || stats.total_time_ms != null || stats.timing?.total != null) && (() => {
        const searchMs = stats.thinking_duration_ms ?? null;
        const agentTotalMs = stats.total_time_ms ?? stats.timing?.total ?? null;
        const agentTtftMs = stats.client_ttft_ms ?? null;
        const responseMs =
          searchMs != null && agentTotalMs != null
            ? Math.max(0, agentTotalMs - searchMs)
            : null;

        // 2-segment bar: search + response
        const searchPct =
          searchMs != null && agentTotalMs != null && agentTotalMs > 0
            ? Math.max(8, Math.min(92, Math.round((searchMs / agentTotalMs) * 100)))
            : 50;
        const responsePct = 100 - searchPct;

        return (
          <div className="space-y-1.5">
            {/* Legend */}
            <div className={`flex items-center gap-3 text-xs ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
              {searchMs != null && (
                <span className="flex items-center gap-1">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"}`} />
                  Search
                </span>
              )}
              <span className="flex items-center gap-1 ml-auto">
                Response
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent/30" : "bg-violet-200"}`} />
              </span>
            </div>

            {/* Bar */}
            {searchMs != null && agentTotalMs != null && (
              <div className="flex h-7 w-full overflow-hidden rounded-md text-xs font-medium">
                <div
                  className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"} text-white`}
                  style={{ width: `${searchPct}%` }}
                >
                  {searchPct > 15 && fmtMs(searchMs)}
                </div>
                <div
                  className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent/30" : "bg-violet-200"} ${isDarkMode ? "text-white/70" : "text-violet-900"}`}
                  style={{ width: `${responsePct}%` }}
                >
                  {responsePct > 15 && responseMs != null && fmtMs(responseMs)}
                </div>
              </div>
            )}

            {/* Axis labels */}
            <div className={`flex justify-between text-xs ${isDarkMode ? "text-white/30" : "text-gray-400"}`}>
              <span>request start</span>
              <span>response complete</span>
            </div>

            {/* Key-value rows */}
            <div className={`mt-1 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"} pt-1.5 space-y-0`}>
              {[
                agentTtftMs != null ? { label: "Time to first token", value: fmtMs(agentTtftMs) } : null,
                searchMs != null ? { label: "Web search duration", value: fmtMs(searchMs) } : null,
                responseMs != null ? { label: "Response generation", value: fmtMs(responseMs) } : null,
              ]
                .filter((r): r is { label: string; value: string } => r != null)
                .map((row, idx) => (
                  <div key={idx} className={`flex justify-between py-1 text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"}`}>
                    <span>{row.label}</span>
                    <span className={isDarkMode ? "text-white/90" : "text-gray-800"}>{row.value}</span>
                  </div>
                ))}
              {agentTotalMs != null && (
                <div className={`flex justify-between py-1 text-xs font-semibold border-t mt-0.5 ${isDarkMode ? "border-zinc-800 text-white" : "border-gray-200 text-gray-900"}`}>
                  <span>Total duration</span>
                  <span>{fmtMs(agentTotalMs)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Stat-card sections (only when backend reports real metrics) */}
      {hasServerMetrics && sections.map((section, i) => (
        <div key={i} className="space-y-2 sm:space-y-3">
          <h3
            className={`text-sm sm:text-base font-medium ${isDarkMode ? "text-white/90" : "text-gray-800"}`}
          >
            {section.title}
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {section.stats.map((stat, j) => (
              <div
                key={j}
                className={`text-center space-y-1 rounded-lg p-2 ${isDarkMode ? "bg-zinc-900/50" : "bg-gray-100"}`}
              >
                <div
                  className={`flex justify-center mb-1 ${isDarkMode ? "text-white/70" : "text-gray-600"}`}
                >
                  {stat.icon}
                </div>
                <div
                  className={`text-sm sm:text-lg font-light ${isDarkMode ? "text-white" : "text-gray-900"}`}
                >
                  {stat.value}
                  {stat.value !== "N/A" && stat.value != null
                    ? (stat.isSmall ? <span>{stat.unit}</span> : stat.unit)
                    : null}
                </div>
                <div
                  className={`text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"} overflow-hidden text-ellipsis px-1`}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Per-Token Timing Details */}
      {hasServerMetrics && tokenTimingStats && (
        <div className="space-y-2 sm:space-y-3">
          <h3
            className={`text-sm sm:text-base font-medium ${isDarkMode ? "text-white/90" : "text-gray-800"}`}
          >
            Per-Token Timing Statistics
          </h3>
          <div className={`rounded-lg p-3 ${isDarkMode ? "bg-zinc-900/50" : "bg-gray-100"}`}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`flex justify-between ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                <span>Mean:</span>
                <span className={isDarkMode ? "text-white" : "text-gray-900"}>{tokenTimingStats.mean.toFixed(1)}ms</span>
              </div>
              <div className={`flex justify-between ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                <span>Median:</span>
                <span className={isDarkMode ? "text-white" : "text-gray-900"}>{tokenTimingStats.median.toFixed(1)}ms</span>
              </div>
              <div className={`flex justify-between ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                <span>P95:</span>
                <span className={isDarkMode ? "text-white" : "text-gray-900"}>{tokenTimingStats.p95.toFixed(1)}ms</span>
              </div>
              <div className={`flex justify-between ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                <span>P99:</span>
                <span className={isDarkMode ? "text-white" : "text-gray-900"}>{tokenTimingStats.p99.toFixed(1)}ms</span>
              </div>
              <div className={`flex justify-between ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                <span>Min:</span>
                <span className={isDarkMode ? "text-white" : "text-gray-900"}>{tokenTimingStats.min.toFixed(1)}ms</span>
              </div>
              <div className={`flex justify-between ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                <span>Max:</span>
                <span className={isDarkMode ? "text-white" : "text-gray-900"}>{tokenTimingStats.max.toFixed(1)}ms</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Hardware Metrics (live from device) ── */}
      {hw && (hw.power_watts || hw.temperature_c || hw.aiclk_mhz) && (
        <div className="space-y-2 sm:space-y-3">
          <h3
            className={`text-sm sm:text-base font-medium ${isDarkMode ? "text-white/90" : "text-gray-800"}`}
          >
            Hardware Metrics
            {hw.board_type && (
              <span className={`ml-2 text-xs font-normal ${isDarkMode ? "text-white/40" : "text-gray-400"}`}>
                {hw.board_type}
              </span>
            )}
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {hw.power_watts != null && (
              <div className={`text-center space-y-1 rounded-lg p-2 ${isDarkMode ? "bg-zinc-900/50" : "bg-gray-100"}`}>
                <div className={`flex justify-center mb-1 ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                  <Gauge className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`} />
                </div>
                <div className={`text-sm sm:text-lg font-light ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  {hw.power_watts}<span className="text-xs ml-0.5">W</span>
                </div>
                <div className={`text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"}`}>Power Draw</div>
              </div>
            )}
            {hw.temperature_c != null && (
              <div className={`text-center space-y-1 rounded-lg p-2 ${isDarkMode ? "bg-zinc-900/50" : "bg-gray-100"}`}>
                <div className={`flex justify-center mb-1 ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                  <Thermometer className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`} />
                </div>
                <div className={`text-sm sm:text-lg font-light ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  {hw.temperature_c}<span className="text-xs ml-0.5">&deg;C</span>
                </div>
                <div className={`text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"}`}>Temperature</div>
              </div>
            )}
            {hw.aiclk_mhz != null && hw.aiclk_mhz > 0 && (
              <div className={`text-center space-y-1 rounded-lg p-2 ${isDarkMode ? "bg-zinc-900/50" : "bg-gray-100"}`}>
                <div className={`flex justify-center mb-1 ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                  <Cpu className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`} />
                </div>
                <div className={`text-sm sm:text-lg font-light ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                  {hw.aiclk_mhz >= 1000
                    ? `${(hw.aiclk_mhz / 1000).toFixed(1)}`
                    : hw.aiclk_mhz}
                  <span className="text-xs ml-0.5">{hw.aiclk_mhz >= 1000 ? "GHz" : "MHz"}</span>
                </div>
                <div className={`text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"}`}>AI Clock</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Efficiency Score ── */}
      {stats.tps_per_watt != null && (
        <div className="space-y-2 sm:space-y-3">
          <h3
            className={`text-sm sm:text-base font-medium ${isDarkMode ? "text-white/90" : "text-gray-800"}`}
          >
            Energy Efficiency
          </h3>
          <div className={`rounded-xl p-4 text-center ${isDarkMode ? "bg-gradient-to-br from-TT-purple-accent/20 to-zinc-900/80 border border-TT-purple-accent/30" : "bg-gradient-to-br from-violet-50 to-white border border-violet-200"}`}>
            <div className="flex items-center justify-center gap-2 mb-1">
              <Leaf className={`h-5 w-5 ${isDarkMode ? "text-green-400" : "text-green-600"}`} />
              <span className={`text-2xl sm:text-3xl font-semibold tabular-nums ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                {stats.tps_per_watt.toFixed(2)}
              </span>
              <span className={`text-sm ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>tok/s/W</span>
            </div>
            <p className={`text-xs ${isDarkMode ? "text-white/40" : "text-gray-400"}`}>
              Performance per watt
              {bestEfficiencyRatio != null && bestEfficiencyRatio > 1 && (
                <span className={`ml-1.5 font-medium ${isDarkMode ? "text-green-400" : "text-green-600"}`}>
                  &mdash; {bestEfficiencyRatio.toFixed(1)}x more efficient than GPU
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── Comparison vs GPU Baselines ── */}
      {efficiencyComparisons.length > 0 && ttTps != null && (
        <div className="space-y-2 sm:space-y-3">
          <h3
            className={`text-sm sm:text-base font-medium ${isDarkMode ? "text-white/90" : "text-gray-800"}`}
          >
            vs GPU Baselines
          </h3>

          {/* Speed comparison */}
          <div className="space-y-2">
            <p className={`text-xs font-medium ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
              Throughput (tok/s)
            </p>
            {(() => {
              const allTps = [ttTps, ...efficiencyComparisons.map((c) => c.gpu_tps)];
              const maxTps = Math.max(...allTps);
              return (
                <div className="space-y-1.5">
                  {/* TT bar */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs w-24 truncate ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                      {hw?.board_type ?? "Tenstorrent"}
                    </span>
                    <div className="flex-1 h-5 rounded overflow-hidden relative" style={{ background: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}>
                      <div
                        className={`h-full rounded ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"}`}
                        style={{ width: `${Math.max(4, (ttTps / maxTps) * 100)}%` }}
                      />
                    </div>
                    <span className={`text-xs tabular-nums w-14 text-right font-medium ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                      {ttTps.toFixed(1)}
                    </span>
                  </div>
                  {/* GPU bars */}
                  {efficiencyComparisons.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`text-xs w-24 truncate ${isDarkMode ? "text-white/40" : "text-gray-400"}`}>
                        {c.gpu.replace("NVIDIA ", "")}
                      </span>
                      <div className="flex-1 h-5 rounded overflow-hidden relative" style={{ background: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}>
                        <div
                          className={`h-full rounded ${isDarkMode ? "bg-white/15" : "bg-gray-300"}`}
                          style={{ width: `${Math.max(4, (c.gpu_tps / maxTps) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs tabular-nums w-14 text-right ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
                        {c.gpu_tps.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Efficiency comparison */}
          {stats.tps_per_watt != null && (
            <div className="space-y-2 mt-3">
              <p className={`text-xs font-medium ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
                Efficiency (tok/s per watt)
              </p>
              {(() => {
                const allEff = [stats.tps_per_watt!, ...efficiencyComparisons.map((c) => c.gpu_tps_per_watt)];
                const maxEff = Math.max(...allEff);
                return (
                  <div className="space-y-1.5">
                    {/* TT bar */}
                    <div className="flex items-center gap-2">
                      <span className={`text-xs w-24 truncate ${isDarkMode ? "text-white/70" : "text-gray-600"}`}>
                        {hw?.board_type ?? "Tenstorrent"}
                      </span>
                      <div className="flex-1 h-5 rounded overflow-hidden relative" style={{ background: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}>
                        <div
                          className={`h-full rounded ${isDarkMode ? "bg-green-500" : "bg-green-500"}`}
                          style={{ width: `${Math.max(4, (stats.tps_per_watt! / maxEff) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs tabular-nums w-14 text-right font-medium ${isDarkMode ? "text-green-400" : "text-green-600"}`}>
                        {stats.tps_per_watt!.toFixed(2)}
                      </span>
                    </div>
                    {/* GPU bars */}
                    {efficiencyComparisons.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`text-xs w-24 truncate ${isDarkMode ? "text-white/40" : "text-gray-400"}`}>
                          {c.gpu.replace("NVIDIA ", "")}
                        </span>
                        <div className="flex-1 h-5 rounded overflow-hidden relative" style={{ background: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}>
                          <div
                            className={`h-full rounded ${isDarkMode ? "bg-white/15" : "bg-gray-300"}`}
                            style={{ width: `${Math.max(4, (c.gpu_tps_per_watt / maxEff) * 100)}%` }}
                          />
                        </div>
                        <span className={`text-xs tabular-nums w-14 text-right ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
                          {c.gpu_tps_per_watt.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          <p className={`text-[10px] leading-relaxed ${isDarkMode ? "text-white/25" : "text-gray-300"}`}>
            GPU baselines are published single-request (batch=1) throughput numbers. TDP is rated board power.
          </p>
        </div>
      )}

      <div
        className={`border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"} pt-2 sm:pt-3 text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2`}
      >
        {hasServerMetrics ? (
          <div className="flex items-center gap-1">
            <Clock
              className={`h-3 w-3 ${isDarkMode ? "text-white/60" : "text-gray-500"}`}
            />
            <span className="whitespace-normal break-words">
              Round trip time:{" "}
              {
                formatValue(
                  (stats.user_ttft_s || 0) +
                    (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
                ).value
              }
              {formatValue(
                (stats.user_ttft_s || 0) +
                  (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
              ).isSmall ? (
                <span className={isDarkMode ? "text-red-400" : "text-red-500"}>
                  {
                    formatValue(
                      (stats.user_ttft_s || 0) +
                        (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
                    ).unit
                  }
                </span>
              ) : (
                formatValue(
                  (stats.user_ttft_s || 0) +
                    (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
                ).unit
              )}
            </span>
          </div>
        ) : displayTotalMs != null ? (
          <div className="flex items-center gap-1">
            <Clock className={`h-3 w-3 ${isDarkMode ? "text-white/60" : "text-gray-500"}`} />
            <span>Total time: {fmtMs(displayTotalMs)}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <Hash
            className={`h-3 w-3 ${isDarkMode ? "text-white/60" : "text-gray-500"}`}
          />
          <span className="whitespace-nowrap">
            Model:{" "}
            <span
              className={
                isDarkMode ? "text-TT-purple-accent" : "text-violet-600"
              }
            >
              {getDisplayModelName()}
            </span>
          </span>
        </div>
      </div>
    </div>
  );

  // Return inline display if requested
  if (inline) {
    const tpsDisplay =
      typeof stats.user_tpot === "number"
        ? (1 / Math.max(stats.user_tpot, 0.000001)).toFixed(1)
        : null;
    const ttftDisplay =
      stats.client_ttft_ms != null
        ? Math.round(stats.client_ttft_ms)
        : stats.user_ttft_s != null
          ? Math.round(stats.user_ttft_s * 1000)
          : null;
    const totalDisplay = stats.total_time_ms != null
      ? stats.total_time_ms >= 1000
        ? `${(stats.total_time_ms / 1000).toFixed(1)}s`
        : `${Math.round(stats.total_time_ms)}ms`
      : stats.timing?.total != null
        ? stats.timing.total >= 1000
          ? `${(stats.timing.total / 1000).toFixed(1)}s`
          : `${Math.round(stats.timing.total)}ms`
        : null;
    const thinkingDisplay = stats.thinking_duration_ms != null
      ? stats.thinking_duration_ms >= 1000
        ? `${(stats.thinking_duration_ms / 1000).toFixed(1)}s`
        : `${Math.round(stats.thinking_duration_ms)}ms`
      : null;
    const effDisplay = stats.tps_per_watt != null
      ? stats.tps_per_watt.toFixed(2)
      : null;
    const effRatioDisplay = bestEfficiencyRatio != null && bestEfficiencyRatio > 1
      ? `${bestEfficiencyRatio.toFixed(1)}x`
      : null;

    type Segment = { label: string | null; value: string; unit?: string; accent?: boolean };
    const segments: (Segment | null)[] = [
      ttftDisplay != null ? { label: "TTFT", value: `${ttftDisplay}ms`, accent: true } : null,
      tpsDisplay != null ? { label: "TPS", value: tpsDisplay, unit: "t/s" } : null,
      effDisplay != null ? { label: "Eff", value: effDisplay, unit: "t/s/W" } : null,
      effRatioDisplay != null ? { label: null, value: effRatioDisplay, unit: " vs GPU", accent: true } : null,
      thinkingDisplay != null ? { label: "Search", value: thinkingDisplay } : null,
      totalDisplay != null && tpsDisplay == null ? { label: "Total", value: totalDisplay } : null,
    ];
    const visibleSegments = segments.filter((s): s is Segment => s !== null);

    return (
      <>
        <div className={`flex items-center gap-1.5 font-mono text-[11px] tabular-nums ${isDarkMode ? "text-white/30" : "text-gray-400"}`}>
          {visibleSegments.map((seg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="opacity-40">·</span>}
              <span className={seg.accent && seg.unit === " vs GPU" ? (isDarkMode ? "text-green-400/70" : "text-green-600/70") : undefined}>
                {seg.label ? `${seg.label} ` : ""}{seg.value}{seg.unit ?? ""}
              </span>
            </React.Fragment>
          ))}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setOpen(true)}
                  className={`ml-0.5 cursor-pointer transition-colors duration-150 ${
                    isDarkMode
                      ? "text-TT-purple-accent/70 hover:text-TT-purple-accent"
                      : "text-violet-400 hover:text-violet-600"
                  }`}
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">View inference details</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Modal dialog for detailed view */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className={`max-w-[95vw] sm:max-w-[540px] max-h-[85vh] overflow-y-auto p-4 sm:p-6 ${isDarkMode ? "bg-black text-white border-zinc-800" : "bg-white text-gray-900 border-gray-200"} rounded-xl`}
          >
            <DialogHeader>
              <DialogTitle
                className={`flex items-center gap-2 text-lg sm:text-xl font-medium ${isDarkMode ? "text-white" : "text-gray-900"}`}
              >
                <Zap
                  className={`h-8 w-8 sm:h-10 sm:w-10 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
                />
                Inference Speed Insights
              </DialogTitle>
              <DialogDescription
                className={`text-sm ${isDarkMode ? "text-white/70" : "text-gray-500"}`}
              >
                Model Inference Performance Metrics
              </DialogDescription>
            </DialogHeader>

            <div
              className={`py-4 sm:py-6 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"}`}
            >
              <StatsDisplay className="space-y-6 sm:space-y-8" />
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
              className="text-gray-500 p-1 h-auto hover:bg-black/10 rounded-full"
            >
              <BarChart2 className="h-4 w-4" />
              <span className="sr-only">Show Speed Insights</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show Speed Insights</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`max-w-[95vw] sm:max-w-[540px] max-h-[85vh] overflow-y-auto p-4 sm:p-6 ${isDarkMode ? "bg-black text-white border-zinc-800" : "bg-white text-gray-900 border-gray-200"} rounded-xl`}
        >
          <DialogHeader>
            <DialogTitle
              className={`flex items-center gap-2 text-lg sm:text-xl font-medium ${isDarkMode ? "text-white" : "text-gray-900"}`}
            >
              <Zap
                className={`h-8 w-8 sm:h-10 sm:w-10 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
              />
              Inference Speed Insights
            </DialogTitle>
            <DialogDescription
              className={`text-sm ${isDarkMode ? "text-white/70" : "text-gray-500"}`}
            >
              Model Inference Performance Metrics
            </DialogDescription>
          </DialogHeader>

          <div
            className={`py-4 sm:py-6 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"}`}
          >
            <StatsDisplay className="space-y-6 sm:space-y-8" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
