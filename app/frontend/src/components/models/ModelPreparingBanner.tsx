// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import { X, Zap, ScrollText, Download, Check } from "lucide-react";
import { Button } from "../ui/button";
import type { ModelRow } from "../../types/models";
import type { StartupPhase } from "../HealthBadge";

interface ModelPreparingBannerProps {
  models: ModelRow[];
  phaseMap: Record<string, StartupPhase | null>;
  onViewLogs: (id: string) => void;
  onDismiss: () => void;
}

// Fallback phase list used when the backend hasn't (yet) provided one. The
// backend response includes a `phases` array + `phase_labels` map keyed by the
// active template (LLM vs media), so this constant should never actually be
// the rendered list except in the first poll cycle before any phase data
// arrives. Keep it sync'd with LLM_PHASES in log_classifier.py for that case.
const FALLBACK_PHASE_ORDER: { key: string; label: string }[] = [
  { key: "container_starting", label: "Starting container" },
  { key: "vllm_importing", label: "Loading vLLM runtime" },
  { key: "downloading_weights", label: "Downloading model weights" },
  { key: "engine_initializing", label: "Initializing inference engine" },
  { key: "device_init", label: "Opening Tenstorrent device" },
  { key: "model_config", label: "Loading model configuration" },
  { key: "loading_weights", label: "Loading model weights" },
  { key: "compiling_model", label: "Compiling inference graph" },
  { key: "engine_ready", label: "Allocating KV cache" },
  { key: "server_starting", label: "Starting API server" },
  { key: "ready", label: "Ready" },
];

function resolvePhaseOrder(
  phase: StartupPhase | null | undefined,
): { key: string; label: string }[] {
  if (phase?.phases && phase.phases.length > 0) {
    const labels = phase.phase_labels ?? {};
    return phase.phases.map((key) => ({ key, label: labels[key] ?? key }));
  }
  return FALLBACK_PHASE_ORDER;
}

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
  if (eta > 86400 * 2) return ">2 d";
  if (eta < 50) return `~${Math.max(1, Math.round(eta))} s`;
  if (eta < 90) return "~1 min";
  if (eta < 3600) return `~${Math.max(1, Math.round(eta / 60))} min`;
  const hours = Math.floor(eta / 3600);
  const mins = Math.round((eta % 3600) / 60);
  return mins === 0 ? `~${hours} h` : `~${hours} h ${mins} m`;
}

// Tiny labeled-value cell for the download stats grid. Label sits above the
// value so the user can scan three numbers at once without parsing punctuation.
function Stat({
  label,
  value,
  mono = true,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col leading-tight min-w-0">
      <span className="text-[9px] uppercase tracking-wider text-stone-500 font-medium">
        {label}
      </span>
      <span
        className={[
          "text-sm tabular-nums truncate",
          mono ? "font-mono" : "",
          muted ? "text-stone-500 italic" : "text-stone-100",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function DownloadDetails({ phase }: { phase: StartupPhase }) {
  // Cached: a sub-second blip on most deploys. Compress to one calm line.
  if (phase.weights_cached) {
    return (
      <div className="flex items-center gap-2 text-emerald-300 text-sm">
        <Check className="w-4 h-4 shrink-0" />
        <span className="truncate">
          Weights already on disk
          {phase.weights_repo ? (
            <span className="text-stone-500"> · {phase.weights_repo}</span>
          ) : null}
        </span>
      </div>
    );
  }

  const downloaded = phase.downloaded_bytes;
  const total = phase.total_bytes;
  const speed = phase.speed_bps;
  const etaText = formatEta(phase.eta_seconds);
  const haveSize = downloaded != null;
  const haveTotal = total != null && total > 0;

  const downloadedText = haveSize && haveTotal
    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
    : haveSize
      ? formatBytes(downloaded)
      : "measuring…";
  const speedText = speed != null && speed > 0
    ? `${formatBytes(speed)}/s`
    : "—";
  const etaDisplay = etaText ?? "—";

  return (
    <div className="flex flex-col gap-2">
      {/* Source line: which repo, with a download icon */}
      <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
        <Download className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {phase.weights_repo ? (
            <>
              Downloading{" "}
              <span className="font-mono text-stone-100">{phase.weights_repo}</span>
            </>
          ) : (
            "Downloading model weights"
          )}
        </span>
      </div>

      {/* Stats grid: 3 columns, labeled. Scannable at a glance. */}
      <div className="grid grid-cols-3 gap-x-4 gap-y-1 px-3 py-2 rounded-md bg-stone-900/60 border border-stone-800/80">
        <Stat
          label="Downloaded"
          value={downloadedText}
          muted={!haveSize}
        />
        <Stat label="Speed" value={speedText} muted={speed == null || speed <= 0} />
        <Stat label="ETA" value={etaDisplay} muted={!etaText} />
      </div>
    </div>
  );
}

function PhaseTrack({
  phase,
  phaseKey,
  hideDownload,
}: {
  phase: StartupPhase | null | undefined;
  phaseKey: string;
  hideDownload: boolean;
}) {
  // Horizontal sequential strip
  // Phase list is dynamic per-model: LLMs get the vLLM-flavored sequence (compile + KV alloc); media models get the FastAPI worker-pool sequence.
  // Source of truth is the backend's `phase.phases` array.
  const allPhases = resolvePhaseOrder(phase);
  const visiblePhases = hideDownload
    ? allPhases.filter((p) => p.key !== "downloading_weights")
    : allPhases;

  // A cached download is effectively  finished, so advance the highlight to the next real phase
  let activeFullIdx = allPhases.findIndex((p) => p.key === phaseKey);
  if (hideDownload && phaseKey === "downloading_weights" && activeFullIdx >= 0) {
    activeFullIdx += 1;
  }
  return (
    <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1 -mx-0.5 px-0.5">
      {visiblePhases.map((p) => {
        const pFullIdx = allPhases.findIndex((x) => x.key === p.key);
        const done = activeFullIdx >= 0 && pFullIdx < activeFullIdx;
        const active = pFullIdx === activeFullIdx;
        return (
          <div
            key={p.key}
            className={[
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 shrink-0",
              "text-[10px] font-medium whitespace-nowrap transition-colors duration-500",
              active
                ? "bg-amber-500/20 border border-amber-400/60 text-amber-200"
                : done
                  ? "bg-stone-900/40 border border-stone-800/60 text-stone-500"
                  : "bg-stone-900/40 border border-stone-800/60 text-stone-100",
            ].join(" ")}
          >
            {done ? (
              <Check className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            ) : (
              <div
                className={[
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  active ? "bg-amber-400 animate-pulse" : "bg-stone-400",
                ].join(" ")}
                aria-hidden="true"
              />
            )}
            <span>{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function CachedBadge({
  bytes,
}: {
  bytes?: number;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full bg-emerald-950/50 border border-emerald-700/50 px-2 py-0.5 text-[10px] text-emerald-300 font-medium shrink-0"
      title="Weights were already cached on disk — download phase was skipped."
    >
      <Check className="w-3 h-3" />
      <span>Cached</span>
      {bytes != null && bytes > 0 && (
        <span className="text-emerald-500/80 font-mono tabular-nums">
          · saved {formatBytes(bytes)}
        </span>
      )}
    </div>
  );
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
  // Backend's _phase_latch keeps weights_cached sticky across polls, so the
  // live flag is reliable for the duration of warmup. When cached, the
  // download phase is invisible to the user — its UI is suppressed and its
  // pill is removed from the phase track.
  const isCached = Boolean(phase?.weights_cached);
  const isDownloading = phaseKey === "downloading_weights" && !isCached;
  const cachedBytes = phase?.total_bytes ?? phase?.downloaded_bytes;
  const haveSize =
    phase?.downloaded_bytes != null || phase?.total_bytes != null;
  const indeterminate = isDownloading && !haveSize;

  return (
    <div className="w-full">
      {/* Header: model name + cached badge (sticky) + percent + logs */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-stone-100 text-sm font-semibold truncate">
            {model.name}
          </span>
          {isCached && <CachedBadge bytes={cachedBytes ?? undefined} />}
          <span className="text-stone-500 text-[11px] truncate">
            {phaseLabel}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-base text-amber-300 tabular-nums font-semibold">
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

      {/* Progress bar — taller during the download phase so the long-running
          phase reads as the main signal. */}
      <div
        className={`relative w-full overflow-hidden rounded-full bg-stone-800/80 mb-3 ${isDownloading ? "h-2.5" : "h-1.5"
          }`}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {indeterminate ? (
          <div className="absolute inset-0 bg-gradient-to-r from-amber-700/40 via-amber-400/70 to-amber-700/40 animate-pulse rounded-full" />
        ) : (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
          />
        )}
      </div>

      {/* Active phase block. Downloading_weights gets the full stats grid;
          other phases get a single label + (optional) detail. */}
      {isDownloading && phase ? (
        <DownloadDetails phase={phase} />
      ) : (
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-amber-300 text-sm font-medium">
            {phaseLabel}
          </span>
          {phase?.last_heartbeat_seconds != null && (
            <span className="text-stone-500 text-xs font-mono tabular-nums">
              · {Math.round(phase.last_heartbeat_seconds)}s elapsed
            </span>
          )}
          {message && (
            <span
              className="text-stone-500 text-xs font-mono truncate min-w-0"
              title={message}
            >
              · {message}
            </span>
          )}
        </div>
      )}

      <PhaseTrack phase={phase} phaseKey={phaseKey} hideDownload={isCached} />
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

      <div className="flex items-start gap-4 px-5 pt-3.5 pb-4">
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

          <div className="flex flex-col gap-6">
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
