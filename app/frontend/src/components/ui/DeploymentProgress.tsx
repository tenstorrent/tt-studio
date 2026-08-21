// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect, useRef } from 'react';
import { Progress } from './progress';

/** Log / TT_PROGRESS lines when host setup finished or weights were already present (no long download). */
function isCacheReadyOrSetupCompleteMessage(msg: string): boolean {
  const t = msg.toLowerCase();
  if (!msg.trim()) return false;
  if (t.includes('setup already completed')) return true;
  if (t.includes('host setup complete') || t.includes('setup complete')) return true;
  // Backend `_weights_progress_monitor` emits this on a cache hit (Docker volume already populated).
  if (t.includes('weights already cached') || t.includes('skipping download')) return true;
  // e.g. "✅ Host setup complete" or similar from structured progress
  if (/[\u2705\u2714\u2713✓]/.test(msg) && t.includes('complete') && /\b(setup|host)\b/.test(t)) {
    return true;
  }
  return false;
}

interface DeploymentProgressProps {
  progress: {
    status: string;
    stage: string;
    progress: number;
    message: string;
    last_updated?: number;
    weights_repo?: string;
    downloaded_bytes?: number;
    total_bytes?: number | null;
    eta_seconds?: number | null;
    speed_bps?: number | null;
    weights_cached?: boolean;
  } | null;
  className?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  onViewLogs?: () => void;
  startTime?: number;
  /** True once the image has been pulled in this deploy. When set, the bar reserves
   *  a leading pull segment; otherwise the download owns the front of the bar. */
  imagePulled?: boolean;
  /** True when the server reports no HuggingFace token configured. Sharpens the
   *  stall troubleshooting message — a missing token is the most common reason a
   *  deploy freezes at 0% (the inference server waits for credentials). */
  hfTokenMissing?: boolean;
}

/** How long the backend progress record may go without an update, while still in
 *  the pre-download stages, before we surface troubleshooting steps. Normal runs
 *  leave these stages within seconds; a run waiting on a missing HF token (or one
 *  that died before emitting progress) never does. Later stages (setup, weights
 *  download) legitimately go quiet for minutes and are excluded. */
const EARLY_STALL_MS = 120_000;
const EARLY_STALL_STAGES = new Set(['starting', 'initialization', 'unknown']);

/** Friendly, stable sub-text for the container-start stages. The backend message for
 *  these can be noisy (e.g. the raw `docker run` command), so we describe the phase
 *  instead — the stage name is the headline, this is the reassuring detail. */
const containerStartMessages: Record<string, string> = {
  starting: 'Starting deployment…',
  initialization: 'Validating configuration…',
  setup: 'Preparing the environment…',
  image_ready: 'Container image ready — launching…',
  container_setup: 'Creating and starting the container…',
  container_started: 'Container is running…',
  network_setup: 'Connecting to the network…',
  finalizing: 'Finalizing the deployment…',
};

const stageDisplayNames: Record<string, string> = {
  initialization: 'Initializing',
  setup: 'Setting up environment',
  // Most models download weights *inside* the container after orchestration —
  // see app/backend/model_control/log_classifier.py downloading_weights phase
  // and ModelPreparingBanner on /models-deployed. The byte/speed/ETA panel
  // below only lights up for the rare host-side download (--host-hf-cache).
  model_preparation: 'Preparing deployment',
  // Host-side Docker image pull that runs before the container starts (uncached
  // images only). Carries real byte/speed/ETA download details, like model_preparation.
  pulling_image: 'Pulling Docker Image',
  // Post-pull container-start milestones (the 50→100% half of the unified bar).
  image_ready: 'Image ready',
  container_setup: 'Starting container',
  container_started: 'Container running',
  network_setup: 'Connecting to network',
  finalizing: 'Finalizing deployment',
  complete: 'Complete',
  error: 'Error',
  stalled: 'Stalled',
  cancelled: 'Cancelled',
  starting: 'Starting',
  unknown: 'Connecting to deployment service',
  not_found: 'Reconnecting to deployment service',
};

const stageIcons: Record<string, string> = {
  initialization: '⚙️',
  setup: '🔧',
  model_preparation: '📦',
  pulling_image: '🐳',
  image_ready: '📦',
  container_setup: '🐳',
  container_started: '🚀',
  network_setup: '🔗',
  finalizing: '🔗',
  complete: '✅',
  error: '❌',
  stalled: '⏱️',
  cancelled: '🛑',
  starting: '🚀'
};

export const DeploymentProgress: React.FC<DeploymentProgressProps> = ({
  progress,
  className = '',
  onRetry,
  onCancel,
  onViewLogs,
  startTime,
  imagePulled = false,
  hfTokenMissing = false
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!startTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  if (!progress) return null;

  const { status, stage, progress: progressPercent, message } = progress;
  const isError = status === 'error' || status === 'failed';
  const showProminentSetupMessage =
    !isError && isCacheReadyOrSetupCompleteMessage(message);
  const isComplete = status === 'completed';
  const isStalled = status === 'stalled';
  const isCancelled = status === 'cancelled';
  const isRunning = status === 'running' || status === 'starting';

  // Stalled before any real work started: the backend record hasn't moved in
  // minutes and the deploy never left the pre-download stages. The 1s elapsed
  // ticker above keeps this re-evaluating while the panel is visible.
  const lastUpdatedMs = progress.last_updated ? progress.last_updated * 1000 : null;
  const stalledEarly =
    isRunning &&
    EARLY_STALL_STAGES.has(progress.stage) &&
    lastUpdatedMs !== null &&
    Date.now() - lastUpdatedMs > EARLY_STALL_MS;

  const formatBytes = (bytes?: number | null) => {
    if (bytes === undefined || bytes === null || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    // Decimal (1000-based) units to match HuggingFace's reported sizes
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes;
    let u = 0;
    while (value >= 1000 && u < units.length - 1) {
      value /= 1000;
      u += 1;
    }
    const decimals = value >= 100 || u === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(decimals)} ${units[u]}`;
  };

  /** Human-readable remaining time; avoids noisy seconds when minutes or hours fit better. */
  const formatEtaRemaining = (eta: number | null | undefined): string | null => {
    if (eta === undefined || eta === null || !Number.isFinite(eta) || eta < 0) return null;
    if (eta > 86400 * 2) return 'More than 2 days left';
    if (eta < 50) return `~${Math.max(1, Math.round(eta))} s left`;
    if (eta < 90) return '~1 min left';
    if (eta < 3600) {
      const mins = Math.max(1, Math.round(eta / 60));
      return `~${mins} min left`;
    }
    const hours = Math.floor(eta / 3600);
    const mins = Math.round((eta % 3600) / 60);
    if (mins === 0) return `~${hours} h left`;
    return `~${hours} h ${mins} min left`;
  };

  // The byte/speed/ETA detail block lights up both for the host-side image pull
  // (stage 'pulling_image') and the in-container weights download ('model_preparation').
  const isImagePull = stage === 'pulling_image';
  const weightsDetails =
    (stage === 'model_preparation' || isImagePull) &&
    (progress.downloaded_bytes !== undefined ||
      progress.speed_bps !== undefined ||
      progress.eta_seconds !== undefined ||
      progress.total_bytes !== undefined);

  const speedText =
    progress.speed_bps !== null && progress.speed_bps !== undefined
      ? `${formatBytes(progress.speed_bps)}/s`
      : null;

  const etaText = formatEtaRemaining(progress.eta_seconds);

  const totalBytes =
    progress.total_bytes !== undefined && progress.total_bytes !== null && progress.total_bytes > 0
      ? progress.total_bytes
      : null;
  const downloadedBytes =
    progress.downloaded_bytes !== undefined && progress.downloaded_bytes !== null
      ? progress.downloaded_bytes
      : null;

  const downloadPercent =
    totalBytes !== null && downloadedBytes !== null
      ? Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100))
      : null;

  // Byte-level download fraction (0–1), used to advance the download segment.
  const downloadFraction =
    totalBytes !== null && downloadedBytes !== null && totalBytes > 0
      ? Math.min(1, Math.max(0, downloadedBytes / totalBytes))
      : null;

  const isContainerStarting =
    !isError && !isComplete && !isStalled && !isCancelled && !isImagePull;

  // Adaptive three-segment bar: image pull → weight download → container start, in
  // the order they occur before the Models Deployed page.
  //   with pull:    pull 0–25, download 25–95, start 95–99
  //   image cached: download 0–95, start 95–99   (pull segment collapses)
  // A weights cache-hit fast-forwards the download segment. Pull and download advance
  // on real byte fractions; container start uses the backend's coarse per-stage progress.
  const hasPull = isImagePull || imagePulled;
  const cacheReady = isCacheReadyOrSetupCompleteMessage(message);
  const [pullLo, pullHi] = hasPull ? [0, 25] : [0, 0];
  const [dlLo, dlHi] = hasPull ? [25, 95] : [0, 95];
  const [startLo, startHi] = [95, 99];
  const lerp = (lo: number, hi: number, f: number) =>
    lo + (hi - lo) * Math.min(1, Math.max(0, f));

  // Only genuine post-download container-start stages map into the tail band. Early
  // stages (starting/initialization/setup, or a transient not_found) precede the
  // download and stay at the start, so the monotonic clamp can't lock the bar high
  // before the download has even begun.
  const containerStartStages = new Set([
    'image_ready', 'container_setup', 'container_started', 'network_setup', 'finalizing', 'complete',
  ]);
  const rawPercent = (() => {
    if (isError || isComplete) return 100;
    if (isImagePull) return lerp(pullLo, pullHi, downloadFraction ?? 0);
    if (stage === 'model_preparation')
      return lerp(dlLo, dlHi, downloadFraction ?? (cacheReady ? 1 : 0));
    if (containerStartStages.has(stage))
      return lerp(startLo, startHi, (progressPercent ?? 0) / 100);
    return hasPull ? pullLo : dlLo;
  })();

  // Clamp monotonic so a noisy/coarse backend value can never make the bar jump
  // backwards. The ref resets naturally — the panel unmounts at completion and
  // remounts per deploy, so each deploy starts fresh at 0.
  const maxPctRef = useRef(0);
  const displayPercent = Math.max(rawPercent, maxPctRef.current);
  maxPctRef.current = displayPercent;

  // Container-start stages carry noisy backend messages (e.g. the raw `docker run`
  // command), so describe the phase instead — the stage name is the headline.
  const displayMessage = isContainerStarting
    ? (containerStartMessages[stage] ?? message)
    : message;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgressBarColor = () => {
    if (isError) return 'bg-destructive';
    if (isComplete) return 'bg-green-500 dark:bg-green-600';
    if (isStalled) return 'bg-yellow-500 dark:bg-yellow-600';
    if (isCancelled) return 'bg-gray-500 dark:bg-gray-600';
    return undefined;
  };


  return (
    <div className={`mt-4 p-4 border rounded-lg bg-card shadow-sm ${className}`}>
      {/* Header with stage and progress */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center">
          {isRunning && (
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mr-2"></div>
          )}
          <span className="text-lg mr-2">{stageIcons[stage] || '⚙️'}</span>
          <span className="text-sm font-medium text-foreground">
            {stage === 'model_preparation' && weightsDetails
              ? 'Downloading model weights'
              : stageDisplayNames[stage] || stage}
          </span>
          {progress.weights_cached && (
            <span
              className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300"
              title="Weights are already in the HuggingFace cache — no download needed."
            >
              <span aria-hidden="true">✓</span> Cached
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {startTime && (
            <span className="text-xs text-muted-foreground">
              {formatTime(elapsedTime)}
            </span>
          )}
          <span className="text-sm text-muted-foreground font-mono">
            {isError ? 'Failed' : isComplete || message.includes('completed') ? '100%' : `${Math.round(displayPercent)}%`}
          </span>
        </div>
      </div>

      {/* Message (highlight when setup finished / weights already on disk) */}
      {showProminentSetupMessage ? (
        <div
          className="rounded-lg border border-emerald-500/45 bg-emerald-500/[0.12] dark:bg-emerald-400/10 px-3 py-3 shadow-sm"
          role="status"
        >
          {/* `message` is verbatim from the API; any ✅ etc. only appears if the backend sent it. */}
          <p className="text-sm sm:text-base font-semibold text-emerald-950 dark:text-emerald-50 leading-snug tracking-tight">
            {message}
          </p>
        </div>
      ) : (
        <p className={`text-xs leading-relaxed ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {displayMessage}
        </p>
      )}

      {/* Single forward-only bar across pull → download → container start,
          clamped monotonic so it never resets backwards. */}
      <div className="mb-3">
        <Progress
          value={displayPercent}
          className="h-2"
          indicatorClassName={`${getProgressBarColor()} transition-[width] duration-300`}
        />
      </div>

      {/* The deploy froze before doing any real work — walk the user through the
          usual fix (missing HF token) instead of leaving a silent 0% bar. */}
      {stalledEarly && (
        <div className="mb-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-3" role="alert">
          <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
            Deployment isn't reporting progress
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
            {hfTokenMissing
              ? 'No Hugging Face token is configured — the server is most likely waiting for credentials it will never receive.'
              : 'The server has not sent an update in a few minutes. The most common cause is a missing or unreadable Hugging Face token.'}
          </p>
          <ol className="list-decimal list-inside space-y-1 text-xs text-yellow-700 dark:text-yellow-300">
            <li>
              Set your Hugging Face token in Settings (gear icon in the navbar), or add{' '}
              <code className="font-mono">HF_TOKEN</code> to the <code className="font-mono">.env</code>{' '}
              file at the repo root and restart TT-Studio.
            </li>
            <li>Cancel this deployment and deploy the model again.</li>
            <li>
              Still stuck? Check <code className="font-mono">logs/model_run.log</code> for{' '}
              "HF_TOKEN not set", and run <code className="font-mono">python run.py --report-bug</code>.
            </li>
          </ol>
        </div>
      )}

      {/* Confirm the pull finished while the container spins up. */}
      {imagePulled && isContainerStarting && (
        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mb-3">
          <span aria-hidden="true">✓</span>
          <span>Image ready</span>
        </div>
      )}

      {weightsDetails && (
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">

            {!isComplete && !isError && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground/80" />
                <span className="text-xs">
                  {downloadPercent !== null && downloadPercent >= 100
                    ? 'Finalizing…' : ''}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono tabular-nums text-foreground/90">
              {totalBytes !== null && downloadedBytes !== null ? (
                <>
                  <span>
                    {formatBytes(downloadedBytes)} of {formatBytes(totalBytes)}
                  </span>
                </>
              ) : downloadedBytes !== null ? (
                <span>{formatBytes(downloadedBytes)} downloaded</span>
              ) : totalBytes !== null ? (
                <span>{formatBytes(totalBytes)} total</span>
              ) : null}
            </div>

            {(speedText || etaText) && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-sans text-[11px] text-muted-foreground">
                {speedText ? <span>{speedText}</span> : null}

                {speedText && etaText ? (
                  <span aria-hidden="true">·</span>
                ) : null}

                {etaText ? <span>{etaText}</span> : null}
              </div>
            )}
          </div>

          {progress.weights_repo ? (
            <div
              className="truncate"
              title={progress.weights_repo}
            >
              {isImagePull ? 'Image' : 'Repo'}: {progress.weights_repo}
            </div>
          ) : null}

          <div className="rounded-md border bg-muted/30 p-2 text-muted-foreground">
            <span className="font-medium text-foreground/80">
              Note:
            </span>{' '}
            {isImagePull
              ? 'The container image is downloading. This only happens the first time — future deploys reuse the cached image.'
              : 'You can leave this page while the model downloads. The download continues in the background, and future deploys will reuse the cached weights.'}
          </div>
        </div>
      )}

      {/* Status indicators */}
      {isError && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-destructive rounded-full mr-2"></div>
            <span className="text-xs text-destructive font-medium">Deployment failed</span>
          </div>
          <div className="flex space-x-2">
            {onViewLogs && (
              <button
                onClick={onViewLogs}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              >
                View Logs
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-xs px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      {isComplete && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-green-500 dark:bg-green-600 rounded-full mr-2"></div>
          <span className="text-xs text-green-600 dark:text-green-400 font-medium">Deployment successful</span>
        </div>
      )}

      {isStalled && (
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-yellow-500 dark:bg-yellow-600 rounded-full mr-2"></div>
            <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">Deployment stalled</span>
          </div>
          <div className="flex space-x-2">
            {onViewLogs && (
              <button
                onClick={onViewLogs}
                className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              >
                View Logs
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-xs px-2 py-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="flex items-center mt-2">
          <div className="w-3 h-3 bg-gray-500 dark:bg-gray-600 rounded-full mr-2"></div>
          <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">Deployment cancelled</span>
        </div>
      )}

      {isRunning && onCancel && (
        <div className="flex justify-end mt-3">
          <button
            onClick={onCancel}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
