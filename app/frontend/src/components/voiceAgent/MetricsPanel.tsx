// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import type { PipelineMetrics } from "./types";

interface MetricsPanelProps {
  metrics: PipelineMetrics | null;
}

function MetricCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | string | undefined;
  unit?: string;
}) {
  const { theme } = useTheme();
  const displayValue = value !== undefined && value !== null ? value : "--";

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        theme === "dark"
          ? "bg-[#111] border-[#222]"
          : "bg-white border-gray-200"
      )}
    >
      <p
        className={cn(
          "text-xs font-medium mb-1",
          theme === "dark" ? "text-gray-500" : "text-gray-400"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          theme === "dark" ? "text-white" : "text-gray-900"
        )}
      >
        {displayValue}
        {unit && value !== undefined && value !== null && (
          <span
            className={cn(
              "text-sm font-normal ml-1",
              theme === "dark" ? "text-gray-500" : "text-gray-400"
            )}
          >
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

function TimingBar({
  label,
  valueMs,
  maxMs = 5000,
}: {
  label: string;
  valueMs: number | undefined;
  maxMs?: number;
}) {
  const { theme } = useTheme();
  const pct = valueMs ? Math.min((valueMs / maxMs) * 100, 100) : 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-xs",
            theme === "dark" ? "text-gray-400" : "text-gray-500"
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "text-xs font-mono tabular-nums",
            theme === "dark" ? "text-gray-300" : "text-gray-600"
          )}
        >
          {valueMs !== undefined ? `${valueMs}ms` : "--"}
        </span>
      </div>
      <div
        className={cn(
          "h-1.5 rounded-full overflow-hidden",
          theme === "dark" ? "bg-[#222]" : "bg-gray-100"
        )}
      >
        <div
          className="h-full rounded-full bg-TT-purple-accent transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  const { theme } = useTheme();

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      {/* Token Usage */}
      <section>
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-3",
            theme === "dark" ? "text-gray-500" : "text-gray-400"
          )}
        >
          Token Usage
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="LLM Tokens" value={metrics?.llm_tokens} />
          <MetricCard
            label="Total Time"
            value={
              metrics?.total_ms !== undefined
                ? (metrics.total_ms / 1000).toFixed(1)
                : undefined
            }
            unit="s"
          />
        </div>
      </section>

      {/* Pipeline Timing */}
      <section>
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-3",
            theme === "dark" ? "text-gray-500" : "text-gray-400"
          )}
        >
          Pipeline Timing
        </h3>
        <div className="flex flex-col gap-3">
          <TimingBar
            label="STT (Whisper)"
            valueMs={metrics?.stt_latency_ms}
            maxMs={5000}
          />
          <TimingBar
            label="LLM TTFB"
            valueMs={metrics?.llm_ttfb_ms}
            maxMs={3000}
          />
          <TimingBar
            label="LLM Total"
            valueMs={metrics?.llm_total_ms}
            maxMs={10000}
          />
          <TimingBar
            label="TTS (SpeechT5)"
            valueMs={metrics?.tts_latency_ms}
            maxMs={10000}
          />
        </div>
      </section>

      {!metrics && (
        <p
          className={cn(
            "text-xs text-center py-8",
            theme === "dark" ? "text-gray-600" : "text-gray-400"
          )}
        >
          Run the voice pipeline to see metrics
        </p>
      )}
    </div>
  );
}
