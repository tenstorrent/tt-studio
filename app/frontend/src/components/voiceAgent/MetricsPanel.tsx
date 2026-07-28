// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import type { PipelineMetrics } from "./types";

interface MetricsPanelProps {
  metrics: PipelineMetrics | null;
  /**
   * "compact" is the inline strip under the header — one scrollable row of
   * figures, sized to sit above the transcript without pushing it off screen.
   * "full" is the original stacked panel.
   */
  variant?: "full" | "compact";
}

function fmtMs(value: number | undefined): string {
  if (value === undefined || value === null) return "--";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

// One figure in the compact strip. Borrows TimingBar's exact typography — muted
// label, mono tabular value — so the inline row reads as the same panel, just
// laid out horizontally.
function InlineStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const { theme } = useTheme();
  return (
    <div className="flex items-baseline gap-1.5 shrink-0">
      <span
        className={cn(
          "text-xs whitespace-nowrap",
          theme === "dark" ? "text-gray-400" : "text-gray-500"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-xs font-mono tabular-nums whitespace-nowrap",
          theme === "dark" ? "text-gray-300" : "text-gray-600"
        )}
      >
        {value}
      </span>
    </div>
  );
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

// Small pill marking which retrieval paths ran on the last turn.
function PathBadge({ label, active }: { label: string; active: boolean }) {
  const { theme } = useTheme();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-mono",
        active
          ? "bg-TT-purple-accent/15 text-TT-purple-accent"
          : theme === "dark"
            ? "bg-white/[0.05] text-gray-600"
            : "bg-black/[0.04] text-gray-400"
      )}
    >
      {label}
    </span>
  );
}

export function MetricsPanel({ metrics, variant = "full" }: MetricsPanelProps) {
  const { theme } = useTheme();

  // Inline strip: one row, horizontally scrollable on narrow widths so the
  // transcript below never loses height and the tile never scrolls sideways.
  if (variant === "compact") {
    return (
      <div className="px-5 py-2.5 text-left">
        {metrics ? (
          <div className="flex items-center gap-4 overflow-x-auto">
            <InlineStat label="STT" value={fmtMs(metrics.stt_latency_ms)} />
            {metrics.rag_used && (
              <InlineStat label="Retrieval" value={fmtMs(metrics.rag_latency_ms)} />
            )}
            {metrics.rag_used && (
              <InlineStat label="Docs" value={String(metrics.rag_doc_count ?? 0)} />
            )}
            <InlineStat label="TTFB" value={fmtMs(metrics.llm_ttfb_ms)} />
            <InlineStat label="LLM" value={fmtMs(metrics.llm_total_ms)} />
            <InlineStat label="TTS" value={fmtMs(metrics.tts_latency_ms)} />
            <InlineStat label="Total" value={fmtMs(metrics.total_ms)} />
            {(metrics.rag_used || metrics.web_search_used) && (
              <div className="flex items-center gap-1.5 ml-auto pl-2 shrink-0">
                {metrics.rag_used && (
                  <PathBadge label={metrics.rag_collection ?? "Knowledge"} active />
                )}
                {metrics.web_search_used && <PathBadge label="Web search" active />}
              </div>
            )}
          </div>
        ) : (
          <p
            className={cn(
              "text-xs",
              theme === "dark" ? "text-gray-600" : "text-gray-400"
            )}
          >
            Metrics appear here after your first turn
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 text-left">
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
          {metrics?.rag_used && (
            <TimingBar
              label="Retrieval (RAG)"
              valueMs={metrics?.rag_latency_ms}
              maxMs={3000}
            />
          )}
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

      {/* Retrieval — only meaningful once a turn has run */}
      {metrics && (
        <section>
          <h3
            className={cn(
              "text-xs font-semibold uppercase tracking-wider mb-3",
              theme === "dark" ? "text-gray-500" : "text-gray-400"
            )}
          >
            Retrieval
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label="Docs Retrieved"
              value={metrics.rag_used ? (metrics.rag_doc_count ?? 0) : undefined}
            />
            <MetricCard
              label="Retrieval Time"
              value={metrics.rag_latency_ms}
              unit="ms"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            <PathBadge
              label={metrics.rag_collection ?? "Knowledge"}
              active={Boolean(metrics.rag_used)}
            />
            <PathBadge label="Web search" active={Boolean(metrics.web_search_used)} />
          </div>
        </section>
      )}

      {!metrics && (
        <p
          className={cn(
            "text-xs py-8",
            theme === "dark" ? "text-gray-600" : "text-gray-400"
          )}
        >
          Run the voice pipeline to see metrics
        </p>
      )}
    </div>
  );
}
