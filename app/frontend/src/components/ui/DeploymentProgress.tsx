// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect } from 'react';
import { Progress } from './progress';

/** Log / TT_PROGRESS lines when host setup finished or weights were already present (no long download). */
function isCacheReadyOrSetupCompleteMessage(msg: string): boolean {
  const t = msg.toLowerCase();
  if (!msg.trim()) return false;
  if (t.includes('setup already completed')) return true;
  if (t.includes('host setup complete') || t.includes('setup complete')) return true;
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
  } | null;
  className?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  onViewLogs?: () => void;
  startTime?: number;
}

const stageDisplayNames: Record<string, string> = {
  initialization: 'Initializing',
  model_preparation: 'Downloading Model Weights',
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
  container_setup: '🐳',
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
  startTime
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

  const formatBytes = (bytes?: number | null) => {
    if (bytes === undefined || bytes === null || bytes < 0) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = bytes;
    let u = 0;
    while (value >= 1024 && u < units.length - 1) {
      value /= 1024;
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

  const weightsDetails =
    stage === 'model_preparation' &&
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
            {stageDisplayNames[stage] || stage}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {startTime && (
            <span className="text-xs text-muted-foreground">
              {formatTime(elapsedTime)}
            </span>
          )}
          <span className="text-sm text-muted-foreground font-mono">
            {isError ? 'Failed' : isComplete || message.includes('completed') ? '100%' : `${Math.min(100, Math.round(downloadPercent ?? 0))}%`}
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
            {message.includes('completed') && message}
          </p>
        </div>
      ) : (
        <p className={`text-xs leading-relaxed ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
          {message}
        </p>
      )}

      {/* Progress bar + weights download details */}
      <div className="mb-3">
        <Progress
          value={
            isError
              ? 100
              : isComplete
                ? 100
                : downloadPercent !== null
                  ? downloadPercent
                  : undefined
          }
          className="h-2"
          indicatorClassName={
            downloadPercent !== null
              ? `${getProgressBarColor()} transition-[width] duration-300`
              : `${getProgressBarColor()} animate-pulse`
          }
        />
      </div>

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
              Repo: {progress.weights_repo}
            </div>
          ) : null}

          <div className="rounded-md border bg-muted/30 p-2 text-muted-foreground">
            <span className="font-medium text-foreground/80">
              Note:
            </span>{' '}
            You can leave this page while the model downloads. The
            download continues in the background, and future deploys
            will reuse the cached weights.
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
