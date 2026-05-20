// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import { X, Zap, ScrollText } from "lucide-react";
import { Button } from "../ui/button";
import type { ModelRow } from "../../types/models";
import type { StartupPhase } from "../HealthBadge";

interface ModelPreparingBannerProps {
  models: ModelRow[];
  phaseMap: Record<string, StartupPhase | null>;
  onViewLogs: (id: string) => void;
  onDismiss: () => void;
}

// Display order used when no phase is reported yet (mirrors the canonical
// order in app/backend/model_control/log_classifier.py). Keep in sync if you
// change the backend phase set.
const PHASE_ORDER: { key: string; label: string }[] = [
  { key: "container_starting",  label: "Starting container" },
  { key: "vllm_importing",      label: "Loading vLLM runtime" },
  { key: "downloading_weights", label: "Downloading model weights" },
  { key: "engine_initializing", label: "Initializing inference engine" },
  { key: "device_init",         label: "Opening Tenstorrent device" },
  { key: "model_config",        label: "Loading model configuration" },
  { key: "loading_weights",     label: "Loading model weights" },
  { key: "compiling_model",     label: "Compiling inference graph" },
  { key: "engine_ready",        label: "Allocating KV cache" },
  { key: "server_starting",     label: "Starting API server" },
  { key: "ready",               label: "Ready" },
];

function formatBytes(n?: number | null): string {
  if (n === undefined || n === null || n < 0) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  const decimals = v >= 100 || u === 0 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(decimals)} ${units[u]}`;
}

function formatEta(eta?: number | null): string | null {
  if (eta === undefined || eta === null || !Number.isFinite(eta) || eta < 0) return null;
  if (eta > 86400 * 2) return "More than 2 days left";
  if (eta < 50) return `~${Math.max(1, Math.round(eta))} s left`;
  if (eta < 90) return "~1 min left";
  if (eta < 3600) return `~${Math.max(1, Math.round(eta / 60))} min left`;
  const hours = Math.floor(eta / 3600);
  const mins = Math.round((eta % 3600) / 60);
  return mins === 0 ? `~${hours} h left` : `~${hours} h ${mins} min left`;
}

function PreparingRow({
  model,
  phase,
  onViewLogs,
}: {
  model: ModelRow;
  phase: StartupPhase | null | undefined;
  onViewLogs: (id: string) => void;
}) {
  const phaseKey = phase?.phase ?? "container_starting";
  const phaseLabel = phase?.phase_label ?? "Connecting…";
  const progress = phase?.progress ?? 0;
  const message = phase?.message ?? "";
  const currentIdx = PHASE_ORDER.findIndex((p) => p.key === phaseKey);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-stone-300 text-sm font-medium truncate">
          {model.name}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-xs text-amber-300 tabular-nums">
            {progress}%
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewLogs(model.id)}
            className="h-6 px-2 border-amber-500/40 text-amber-300 hover:bg-amber-950/40 hover:border-amber-400 gap-1"
          >
            <ScrollText className="w-3 h-3" />
            <span className="text-[10px]">Logs</span>
          </Button>
        </div>
      </div>

      {/* Real progress bar driven by backend signal */}
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-stone-800/80 mb-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
        />
      </div>

      {/* Active phase label + a short detail line if we have one */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-amber-300 text-xs font-medium">{phaseLabel}</span>
        {phase?.last_heartbeat_seconds !== null &&
          phase?.last_heartbeat_seconds !== undefined && (
            <span className="text-stone-500 text-[11px] font-mono tabular-nums">
              · {Math.round(phase.last_heartbeat_seconds)}s elapsed
            </span>
          )}
      </div>
      {message && (
        <div
          className="text-stone-500 text-[11px] font-mono truncate"
          title={message}
        >
          {message}
        </div>
      )}

      {/* Live HF download stats (only while in the downloading_weights phase
          and Django has populated byte fields). */}
      {phaseKey === "downloading_weights" &&
        (phase?.downloaded_bytes !== undefined ||
          phase?.total_bytes !== undefined ||
          phase?.speed_bps !== undefined ||
          phase?.eta_seconds !== undefined) && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-mono tabular-nums text-amber-200/90">
            {phase?.total_bytes != null && phase?.downloaded_bytes != null ? (
              <span>
                {formatBytes(phase.downloaded_bytes)} of {formatBytes(phase.total_bytes)}
              </span>
            ) : phase?.downloaded_bytes != null ? (
              <span>{formatBytes(phase.downloaded_bytes)} downloaded</span>
            ) : null}
            {phase?.speed_bps != null && (
              <>
                <span className="text-stone-600" aria-hidden="true">·</span>
                <span>{formatBytes(phase.speed_bps)}/s</span>
              </>
            )}
            {(() => {
              const etaText = formatEta(phase?.eta_seconds);
              return etaText ? (
                <>
                  <span className="text-stone-600" aria-hidden="true">·</span>
                  <span>{etaText}</span>
                </>
              ) : null;
            })()}
            {phase?.weights_cached && (
              <span className="text-emerald-300">· cached — skipping download</span>
            )}
          </div>
        )}

      {/* Phase track: previous phases muted, current highlighted, upcoming dim */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {PHASE_ORDER.map((p, i) => (
          <span
            key={p.key}
            className={`flex items-center gap-1.5 text-[10px] transition-colors duration-500 ${
              currentIdx === -1
                ? "text-stone-600"
                : i < currentIdx
                  ? "text-stone-600"
                  : i === currentIdx
                    ? "text-amber-300 font-medium"
                    : "text-stone-600"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-500 ${
                currentIdx === -1
                  ? "bg-stone-700"
                  : i < currentIdx
                    ? "bg-stone-700"
                    : i === currentIdx
                      ? "bg-amber-400 animate-pulse"
                      : "bg-stone-700/50"
              }`}
            />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ModelPreparingBanner({
  models,
  phaseMap,
  onViewLogs,
  onDismiss,
}: ModelPreparingBannerProps): JSX.Element {
  return (
    <div className="mx-6 mb-4 rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-950/25 via-stone-900/30 to-transparent overflow-hidden">
      {/* Thin amber top accent line */}
      <div className="h-px w-full bg-gradient-to-r from-amber-500/60 via-amber-400/30 to-transparent" />

      <div className="flex items-start gap-4 px-4 pt-3 pb-4">
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="font-mono text-amber-400 text-xs font-semibold tracking-widest uppercase">
              Warming Up
            </span>
            {models.length > 1 && (
              <span className="text-stone-500 text-xs">
                · {models.length} models
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {models.map((m) => (
              <PreparingRow
                key={m.id}
                model={m}
                phase={phaseMap[m.id]}
                onViewLogs={onViewLogs}
              />
            ))}
          </div>
        </div>

        {/* Right: dismiss */}
        <Button
          size="icon"
          variant="ghost"
          onClick={onDismiss}
          className="w-7 h-7 shrink-0 mt-0.5 text-stone-600 hover:text-stone-400"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
