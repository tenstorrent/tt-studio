// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState, useCallback } from "react";

export const CANCELLATION_GRACE_PERIOD_SECONDS = 30;

const STORAGE_PREFIX = "cancelling_since_";
const CANCEL_SYNC_EVENT = "tt_cancelling_timestamp_sync";
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

export function getCancellingSinceKey(jobId: string): string {
  return `${STORAGE_PREFIX}${jobId}`;
}

export function recordCancellingSince(jobId: string, timestampMs: number = Date.now()): void {
  try {
    localStorage.setItem(getCancellingSinceKey(jobId), timestampMs.toString());
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CANCEL_SYNC_EVENT, { detail: { jobId, timestampMs } })
      );
    }
  } catch {
    // LocalStorage may be unavailable in private browsing or constrained environments
  }
}

export function clearCancellingSince(jobId: string): void {
  try {
    localStorage.removeItem(getCancellingSinceKey(jobId));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CANCEL_SYNC_EVENT, { detail: { jobId, timestampMs: null } })
      );
    }
  } catch {
    // Ignore
  }
}

export interface UseCancellationGracePeriodOptions {
  gracePeriodSeconds?: number;
}

export interface UseCancellationGracePeriodResult {
  isCancelling: boolean;
  isGracePeriodActive: boolean;
  remainingSeconds: number;
}

export function useCancellationGracePeriod(
  jobId: string | undefined,
  status: string | undefined,
  options: UseCancellationGracePeriodOptions = {}
): UseCancellationGracePeriodResult {
  const gracePeriodSeconds = options.gracePeriodSeconds ?? CANCELLATION_GRACE_PERIOD_SECONDS;
  const isCancelling = status === "cancelling";

  const calculateRemainingSeconds = useCallback((): number => {
    if (!jobId || !isCancelling) return 0;
    try {
      const key = getCancellingSinceKey(jobId);
      let startedStr = localStorage.getItem(key);
      if (!startedStr) {
        // First observer of the cancelling status initializes the shared universal timestamp
        const now = Date.now();
        localStorage.setItem(key, now.toString());
        startedStr = now.toString();
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(CANCEL_SYNC_EVENT, { detail: { jobId, timestampMs: now } })
          );
        }
      }
      const startedAt = parseInt(startedStr, 10);
      if (isNaN(startedAt)) return 0;

      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = gracePeriodSeconds - elapsedSeconds;
      return remaining > 0 ? remaining : 0;
    } catch {
      return 0;
    }
  }, [jobId, isCancelling, gracePeriodSeconds]);

  const [remainingSeconds, setRemainingSeconds] = useState<number>(calculateRemainingSeconds);

  // Sync remaining seconds on a 1-second interval while active
  useEffect(() => {
    if (!jobId || !isCancelling) {
      setRemainingSeconds(0);
      return;
    }

    const syncRemaining = () => {
      const remaining = calculateRemainingSeconds();
      setRemainingSeconds(remaining);
      return remaining;
    };

    const initial = syncRemaining();
    if (initial <= 0) return;

    const interval = setInterval(() => {
      const remaining = syncRemaining();
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [jobId, isCancelling, calculateRemainingSeconds]);

  // Synchronize across multiple components on the same page and across browser tabs
  useEffect(() => {
    if (!jobId || !isCancelling) return;

    const handleSync = (event: Event) => {
      const customEvent = event as CustomEvent<{ jobId?: string }>;
      if (!customEvent.detail || customEvent.detail.jobId === jobId) {
        setRemainingSeconds(calculateRemainingSeconds());
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === getCancellingSinceKey(jobId)) {
        setRemainingSeconds(calculateRemainingSeconds());
      }
    };

    window.addEventListener(CANCEL_SYNC_EVENT, handleSync);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(CANCEL_SYNC_EVENT, handleSync);
      window.removeEventListener("storage", handleStorage);
    };
  }, [jobId, isCancelling, calculateRemainingSeconds]);

  // Clean up storage ONLY when job reaches a definitive terminal state (never during loading)
  useEffect(() => {
    if (jobId && status && TERMINAL_STATUSES.includes(status)) {
      clearCancellingSince(jobId);
    }
  }, [jobId, status]);

  const isGracePeriodActive = isCancelling && remainingSeconds > 0;

  return {
    isCancelling,
    isGracePeriodActive,
    remainingSeconds,
  };
}
