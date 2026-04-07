// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle, Rocket, X } from "lucide-react";
import { Button } from "../ui/button";
import { stageDisplayNames } from "../ui/DeploymentProgress";
import { useDeploymentProgress } from "../../hooks/useDeploymentProgress";
import { safeGetItem, safeRemoveItem } from "../../lib/storage";

const ACTIVE_DEPLOYMENT_KEY = "tt_studio_active_deployment_job";
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours — covers backend's 5h timeout with buffer

interface ActiveDeploymentBannerProps {
  onComplete: () => void;
}

export default function ActiveDeploymentBanner({ onComplete }: ActiveDeploymentBannerProps) {
  const navigate = useNavigate();

  // Read localStorage once (lazy useState initializer runs exactly once per mount)
  const [storedJob] = useState<{ jobId: string; startedAt: number } | null>(() => {
    const stored = safeGetItem<{ jobId?: string; startedAt?: number } | null>(
      ACTIVE_DEPLOYMENT_KEY,
      null
    );
    if (!stored?.jobId) return null;
    const age = Date.now() - (stored.startedAt ?? 0);
    if (age > MAX_AGE_MS) {
      safeRemoveItem(ACTIVE_DEPLOYMENT_KEY);
      return null;
    }
    return { jobId: stored.jobId, startedAt: stored.startedAt ?? Date.now() };
  });

  // All hooks called unconditionally (React rules)
  const [dismissed, setDismissed] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const { progress, startPolling } = useDeploymentProgress(2000);

  // Start polling once on mount if we have a job
  useEffect(() => {
    if (!storedJob) return;
    startPolling(storedJob.jobId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Elapsed time counter
  useEffect(() => {
    if (!storedJob) return;
    const startedAt = storedJob.startedAt;
    setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // React to terminal progress states
  useEffect(() => {
    if (!progress) return;

    if (progress.status === "completed") {
      safeRemoveItem(ACTIVE_DEPLOYMENT_KEY);
      setShowSuccess(true);
      const timer = setTimeout(() => {
        onComplete();
        setDismissed(true);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (
      progress.status === "error" ||
      progress.status === "failed" ||
      progress.status === "timeout" ||
      progress.status === "cancelled"
    ) {
      safeRemoveItem(ACTIVE_DEPLOYMENT_KEY);
      let msg = progress.message || "Deployment failed.";
      if (msg.startsWith("exception: ")) msg = msg.substring("exception: ".length);
      setHasError(true);
      setErrorMessage(msg);
    }

    if (progress.status === "not_found") {
      // Server may have restarted — silently dismiss, model may already be running
      safeRemoveItem(ACTIVE_DEPLOYMENT_KEY);
      setDismissed(true);
    }
  }, [progress, onComplete]);

  // No active job — render nothing
  if (!storedJob) return null;
  // Dismissed — render nothing (but polling hook still ran above)
  if (dismissed && !showSuccess) return null;

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatBytes = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${v >= 100 || u === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[u]}`;
  };

  // ── Success flash ──────────────────────────────────────────────────────────
  if (showSuccess) {
    return (
      <div className="mx-6 mb-4 rounded-lg border border-green-500/20 bg-gradient-to-r from-green-950/25 via-stone-900/30 to-transparent overflow-hidden">
        <div className="h-px w-full bg-gradient-to-r from-green-500/60 via-green-400/30 to-transparent" />
        <div className="flex items-center gap-2.5 px-4 py-3">
          <CheckCircle className="h-3.5 w-3.5 text-green-400 shrink-0" />
          <span className="font-mono text-green-400 text-xs font-semibold tracking-widest uppercase">
            Deployment Complete
          </span>
          <span className="text-stone-400 text-xs">— loading your model…</span>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (hasError) {
    return (
      <div className="mx-6 mb-4 rounded-lg border border-red-500/20 bg-gradient-to-r from-red-950/25 via-stone-900/30 to-transparent overflow-hidden">
        <div className="h-px w-full bg-gradient-to-r from-red-500/60 via-red-400/30 to-transparent" />
        <div className="flex items-start gap-4 px-4 pt-3 pb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              <span className="font-mono text-red-400 text-xs font-semibold tracking-widest uppercase">
                Deployment Failed
              </span>
            </div>
            <p className="text-stone-300 text-xs break-words leading-relaxed">{errorMessage}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/deployment-history")}
              className="border-red-500/40 text-red-400 hover:bg-red-950/40 hover:border-red-400 h-7 text-xs px-2.5"
            >
              View History
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="w-7 h-7 text-stone-600 hover:text-stone-400"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Progress state ─────────────────────────────────────────────────────────
  const stage = progress?.stage ?? "initialization";
  const progressPercent = progress?.progress ?? 0;
  const message = progress?.message ?? "Starting deployment...";
  const stageLabel = stageDisplayNames[stage] ?? stage;

  const showDownloadDetails =
    stage === "model_preparation" &&
    progress &&
    (progress.downloaded_bytes !== undefined || progress.speed_bps !== undefined);

  const speedText = progress?.speed_bps
    ? `${formatBytes(progress.speed_bps)}/s`
    : null;

  return (
    <div className="mx-6 mb-4 rounded-lg border border-blue-500/20 bg-gradient-to-r from-blue-950/25 via-stone-900/30 to-transparent overflow-hidden">
      {/* Thin blue top accent line */}
      <div className="h-px w-full bg-gradient-to-r from-blue-500/60 via-blue-400/30 to-transparent" />

      <div className="flex items-start gap-4 px-4 pt-3 pb-4">
        {/* Left: content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Rocket className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              <span className="font-mono text-blue-400 text-xs font-semibold tracking-widest uppercase">
                Deploying
              </span>
              <span className="text-stone-400 text-xs">— {stageLabel}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono text-stone-500 text-xs tabular-nums">
                {formatElapsed(elapsedSeconds)}
              </span>
              <span className="font-mono text-stone-400 text-xs tabular-nums font-medium">
                {progressPercent}%
              </span>
            </div>
          </div>

          {/* Progress bar — determinate, driven by backend % */}
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-stone-800/80 mb-2">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-700 ease-out"
              style={{ width: `${Math.max(progressPercent, 3)}%` }}
            />
          </div>

          {/* Stage message */}
          <p className="text-stone-400 text-xs leading-relaxed">{message}</p>

          {/* Download details — only shown when weights are being downloaded */}
          {showDownloadDetails && (
            <div className="mt-2 space-y-1.5">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums text-xs text-stone-500">
                {progress?.downloaded_bytes !== undefined && (
                  <span>{formatBytes(progress.downloaded_bytes)} downloaded</span>
                )}
                {speedText && <span>• {speedText}</span>}
              </div>
              <div className="rounded border border-stone-700/40 bg-stone-900/40 px-2.5 py-1.5 text-xs text-stone-500 leading-relaxed">
                <span className="font-medium text-stone-400">Tip:</span> You can leave this page
                — the download continues in the background.
              </div>
            </div>
          )}
        </div>

        {/* Right: dismiss */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setDismissed(true)}
          className="w-7 h-7 shrink-0 mt-0.5 text-stone-600 hover:text-stone-400"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
