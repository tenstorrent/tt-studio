// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { useState } from "react";
import {
  BarChart2,
  Clock,
  Zap,
  Hash,
  AlignJustify,
  FileText,
  Activity,
  Timer,
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
    {
      title: "Token Metrics",
      stats: [
        {
          icon: (
            <Hash
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.tokens_decoded,
          label: "Tokens Decoded",
          unit: "",
          isSmall: false,
        } as StatItem,
        {
          icon: (
            <FileText
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.tokens_prefilled,
          label: "Context In",
          unit: "",
          isSmall: false,
        } as StatItem,
        {
          icon: (
            <AlignJustify
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.context_length,
          label: "Context Length",
          unit: "",
          isSmall: false,
        } as StatItem,
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
  const ttftPct =
    ttftMs != null && displayTotalMs != null && displayTotalMs > 0
      ? Math.max(5, Math.min(95, Math.round((ttftMs / displayTotalMs) * 100)))
      : 30;
  const genPct = 100 - ttftPct;

  const fmtMs = (ms: number) =>
    ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

  // Reusable stats display component
  const StatsDisplay = ({ className = "" }: { className?: string }) => (
    <div className={`space-y-4 sm:space-y-6 ${className}`}>

      {/* ── Bar + summary ── */}
      {ttftMs != null && generationMs != null && (
        <div className="space-y-1.5">
          {/* Legend */}
          <div className={`flex items-center justify-between text-xs ${isDarkMode ? "text-white/50" : "text-gray-500"}`}>
            <span className="flex items-center gap-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"}`} />
              TTFT
            </span>
            <span>→</span>
            <span className="flex items-center gap-1">
              Generation
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isDarkMode ? "bg-TT-purple-accent/40" : "bg-violet-300"}`} />
            </span>
          </div>

          {/* Bar */}
          <div className="flex h-7 w-full overflow-hidden rounded-md text-xs font-medium">
            <div
              className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent" : "bg-violet-600"} text-white`}
              style={{ width: `${ttftPct}%` }}
            >
              {ttftPct > 15 && fmtMs(ttftMs)}
            </div>
            <div
              className={`flex items-center justify-center ${isDarkMode ? "bg-TT-purple-accent/40" : "bg-violet-300"} ${isDarkMode ? "text-white/80" : "text-violet-900"}`}
              style={{ width: `${genPct}%` }}
            >
              {genPct > 15 && fmtMs(generationMs)}
            </div>
          </div>

          {/* Axis labels */}
          <div className={`flex justify-between text-xs ${isDarkMode ? "text-white/30" : "text-gray-400"}`}>
            <span>time to first token</span>
            <span>token generation</span>
          </div>

          {/* Compact key-value rows */}
          <div className={`mt-1 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"} pt-1.5 space-y-0`}>
            {[
              { label: "TTFT (client-measured)", value: fmtMs(ttftMs) },
              { label: "Generation time",         value: fmtMs(generationMs) },
              { label: "Throughput (estimated)",  value: userTPS !== "N/A" ? `${userTPS} t/s` : null },
              { label: "Tokens",                  value: (stats.tokens_prefilled || stats.tokens_decoded) ? `${stats.tokens_prefilled ?? 0} in / ${stats.tokens_decoded ?? 0} out` : null },
            ]
              .filter((r) => r.value != null)
              .map((row, idx, arr) => (
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

      {sections.map((section, i) => (
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
                  {stat.isSmall ? <span>{stat.unit}</span> : stat.unit}
                </div>
                <div
                  className={`text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"} overflow-hidden text-ellipsis px-1`}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
          {section.title === "Token Metrics" && (
            <p className={`text-[11px] leading-relaxed ${isDarkMode ? "text-white/30" : "text-gray-400"}`}>
              <span className={isDarkMode ? "text-white/50" : "text-gray-500"}>Context In</span> includes your message, system prompt, conversation history, and chat template overhead — not just the words you typed.
            </p>
          )}
        </div>
      ))}

      {/* Per-Token Timing Details */}
      {tokenTimingStats && (
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

      <div
        className={`border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"} pt-2 sm:pt-3 text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2`}
      >
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
    const tokensIn = stats.tokens_prefilled ?? 0;
    const tokensOut = stats.tokens_decoded ?? 0;

    type Segment = { label: string | null; value: string; unit?: string; accent?: boolean };
    const segments: Segment[] = [
      ttftDisplay != null ? { label: "TTFT", value: `${ttftDisplay}ms`, accent: true } : null,
      tpsDisplay != null ? { label: "TPS", value: tpsDisplay, unit: "t/s" } : null,
      // tokens shown in modal only
    ].filter((s): s is Segment => s != null);

    return (
      <>
        <div className={`flex items-center gap-1.5 font-mono text-[11px] tabular-nums ${isDarkMode ? "text-white/30" : "text-gray-400"}`}>
          {segments.map((seg, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="opacity-40">·</span>}
              <span>{seg.label ? `${seg.label} ` : ""}{seg.value}{seg.unit ?? ""}</span>
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
            className={`max-w-[95vw] sm:max-w-[500px] p-4 sm:p-6 ${isDarkMode ? "bg-black text-white border-zinc-800" : "bg-white text-gray-900 border-gray-200"} rounded-xl`}
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
          className={`max-w-[95vw] sm:max-w-[500px] p-4 sm:p-6 ${isDarkMode ? "bg-black text-white border-zinc-800" : "bg-white text-gray-900 border-gray-200"} rounded-xl`}
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
