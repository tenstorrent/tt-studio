// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";

export const CANCELLATION_GRACE_PERIOD_SECONDS = 30;

const STORAGE_PREFIX = "cancelling_since_";
const CANCEL_SYNC_EVENT = "tt_cancelling_timestamp_sync";
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

// In-memory fallback when localStorage throws (e.g. private browsing or quota exceeded).
const memoryTimestamps = new Map<string, number>();
// Tracks IDs whose timestamp only lives in memory because localStorage.setItem failed.
const storageFallbackIds = new Set<string>();

interface CancelSyncDetail {
  jobId?: string;
  timestampMs?: number | null;
}

export function getCancellingSinceKey(jobId: string): string {
  return `${STORAGE_PREFIX}${jobId}`;
}

function readCancellingSince(jobId: string): number | null {
  const key = getCancellingSinceKey(jobId);
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed)) {
        memoryTimestamps.set(jobId, parsed);
        storageFallbackIds.delete(jobId);
        return parsed;
      }
      return null;
    }
    return storageFallbackIds.has(jobId)
      ? (memoryTimestamps.get(jobId) ?? null)
      : null;
  } catch {
    return memoryTimestamps.get(jobId) ?? null;
  }
}

function computeRemainingSeconds(
  startedAt: number,
  gracePeriodSeconds: number
): number {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const remaining = gracePeriodSeconds - elapsedSeconds;
  return remaining > 0 ? remaining : 0;
}

function dispatchCancelSync(jobId: string, timestampMs: number | null): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<CancelSyncDetail>(CANCEL_SYNC_EVENT, {
        detail: { jobId, timestampMs },
      })
    );
  }
}

export function recordCancellingSince(
  jobId: string,
  timestampMs: number = Date.now()
): void {
  memoryTimestamps.set(jobId, timestampMs);
  try {
    localStorage.setItem(getCancellingSinceKey(jobId), timestampMs.toString());
    storageFallbackIds.delete(jobId);
  } catch {
    // LocalStorage may be unavailable in private browsing or constrained environments
    storageFallbackIds.add(jobId);
  }
  dispatchCancelSync(jobId, timestampMs);
}

export function clearCancellingSince(jobId: string): void {
  memoryTimestamps.delete(jobId);
  storageFallbackIds.delete(jobId);
  try {
    localStorage.removeItem(getCancellingSinceKey(jobId));
  } catch {
    // Ignore
  }
  dispatchCancelSync(jobId, null);
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
  const gracePeriodSeconds =
    options.gracePeriodSeconds ?? CANCELLATION_GRACE_PERIOD_SECONDS;
  const isCancelling = status === "cancelling";

  const [startedAt, setStartedAt] = useState<number | null>(() =>
    jobId && isCancelling ? readCancellingSince(jobId) : null
  );
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    if (!jobId || !isCancelling) return 0;
    const existing = readCancellingSince(jobId);
    // Avoid a 1-frame unlocked flash before the seeding effect records Date.now().
    return existing !== null
      ? computeRemainingSeconds(existing, gracePeriodSeconds)
      : gracePeriodSeconds;
  });

  // Seed timestamp once when entering cancelling (if absent) and listen for sync/clear events.
  useEffect(() => {
    if (!jobId || !isCancelling) {
      setStartedAt(null);
      setRemainingSeconds(0);
      return;
    }

    let initialStartedAt = readCancellingSince(jobId);
    if (initialStartedAt === null) {
      // First observer of the cancelling status initializes the shared universal timestamp
      initialStartedAt = Date.now();
      recordCancellingSince(jobId, initialStartedAt);
    }
    setStartedAt(initialStartedAt);
    setRemainingSeconds(
      computeRemainingSeconds(initialStartedAt, gracePeriodSeconds)
    );

    const handleSync = (event: Event) => {
      const { detail } = event as CustomEvent<CancelSyncDetail>;
      if (detail && detail.jobId && detail.jobId !== jobId) return;

      if (detail?.timestampMs === null) {
        memoryTimestamps.delete(jobId);
        storageFallbackIds.delete(jobId);
        setStartedAt(null);
        setRemainingSeconds(0);
        return;
      }

      const nextStartedAt =
        typeof detail?.timestampMs === "number"
          ? detail.timestampMs
          : readCancellingSince(jobId);
      setStartedAt(nextStartedAt);
      setRemainingSeconds(
        nextStartedAt !== null
          ? computeRemainingSeconds(nextStartedAt, gracePeriodSeconds)
          : 0
      );
    };

    const key = getCancellingSinceKey(jobId);
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;

      if (event.newValue === null) {
        memoryTimestamps.delete(jobId);
        storageFallbackIds.delete(jobId);
        setStartedAt(null);
        setRemainingSeconds(0);
        return;
      }

      const parsed = parseInt(event.newValue, 10);
      if (Number.isNaN(parsed)) {
        setStartedAt(null);
        setRemainingSeconds(0);
        return;
      }
      memoryTimestamps.set(jobId, parsed);
      storageFallbackIds.delete(jobId);
      setStartedAt(parsed);
      setRemainingSeconds(computeRemainingSeconds(parsed, gracePeriodSeconds));
    };

    window.addEventListener(CANCEL_SYNC_EVENT, handleSync);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(CANCEL_SYNC_EVENT, handleSync);
      window.removeEventListener("storage", handleStorage);
    };
  }, [jobId, isCancelling, gracePeriodSeconds]);

  // Sync remaining seconds on a 1-second interval while active
  useEffect(() => {
    if (!isCancelling || startedAt === null) {
      setRemainingSeconds(0);
      return;
    }

    const syncRemaining = () => {
      const remaining = computeRemainingSeconds(startedAt, gracePeriodSeconds);
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
  }, [isCancelling, startedAt, gracePeriodSeconds]);

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
