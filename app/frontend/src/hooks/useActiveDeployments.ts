// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import { safeGetItem, safeSetItem } from "../lib/storage";
import { DEFAULT_DEPLOYMENT_PROGRESS_POLL_MS } from "./useDeploymentProgress";

// Progress payload as returned by /docker-api/deploy/progress/{job_id}/.
// Mirrors the shape DeploymentProgress consumes.
export interface DeploymentProgressData {
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
}

export type DeploymentLifecycle = "active" | "completed" | "failed";

export interface ActiveDeployment {
  jobId: string;
  modelId: string;
  modelName: string;
  // Devices this deploy occupies. Empty when the backend auto-allocates and the
  // slot isn't known up front (still reserved once chip-status reflects it).
  deviceIds: number[];
  startedAt: number;
  status: DeploymentLifecycle;
  // True once a 'pulling_image' stage is seen — keeps the unified pull→start bar
  // visible through the container-start phase.
  hadImagePull: boolean;
}

const STORAGE_KEY = "tt_studio_active_deployments";
// Long enough for a multi-GB image pull; not_found handling reaps jobs the server
// has forgotten (e.g. after a restart), so a stale entry can't linger past that.
const MAX_RESUME_AGE_MS = 60 * 60 * 1000;
// Keep a completed card visible briefly before it self-dismisses.
const COMPLETED_LINGER_MS = 4000;
// not_found tolerance while a just-submitted job registers on the backend.
const NOT_FOUND_GRACE_MS = 90 * 1000;
const MAX_NOT_FOUND_RETRIES = 5;

const TERMINAL_ERROR = new Set(["error", "failed", "timeout", "cancelled"]);

interface UseActiveDeploymentsOptions {
  // Called when a job reaches a terminal state, so callers can refresh
  // chip-status (a slot is freed on failure, or authoritatively claimed on success).
  onResolved?: (jobId: string, status: DeploymentLifecycle) => void;
}

interface UseActiveDeploymentsReturn {
  deployments: ActiveDeployment[];
  progressByJob: Record<string, DeploymentProgressData>;
  addDeployment: (d: Omit<ActiveDeployment, "status" | "hadImagePull">) => void;
  removeDeployment: (jobId: string) => void;
  // Devices reserved by still-active deploys — overlaid onto chip-status so the
  // model list greys out configurations that a pending deploy already claimed.
  reservedDeviceIds: number[];
}

/**
 * Tracks every in-flight deployment for the current session: persists them across
 * navigation/reload, polls each job's progress, and frees its reservation the moment
 * it succeeds or fails. This is the single source of truth for the deploy wizard's
 * progress tray and its capacity-aware model greying.
 */
export function useActiveDeployments(
  options: UseActiveDeploymentsOptions = {}
): UseActiveDeploymentsReturn {
  const [deployments, setDeployments] = useState<ActiveDeployment[]>(() => {
    const stored = safeGetItem<ActiveDeployment[]>(STORAGE_KEY, []);
    const now = Date.now();
    // Drop entries too old to safely resume, and any left in a terminal state.
    return stored.filter(
      (d) => d.status === "active" && now - (d.startedAt ?? 0) < MAX_RESUME_AGE_MS
    );
  });
  const [progressByJob, setProgressByJob] = useState<Record<string, DeploymentProgressData>>({});

  // Keep onResolved current without re-running the polling effect.
  const onResolvedRef = useRef(options.onResolved);
  onResolvedRef.current = options.onResolved;

  // Timers we must clear on unmount (completed-card linger removals).
  const lingerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Persist only active deploys; terminal ones are transient UI state.
  useEffect(() => {
    safeSetItem(STORAGE_KEY, deployments.filter((d) => d.status === "active"));
  }, [deployments]);

  const removeDeployment = useCallback((jobId: string) => {
    setDeployments((prev) => prev.filter((d) => d.jobId !== jobId));
    setProgressByJob((prev) => {
      if (!(jobId in prev)) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  const addDeployment = useCallback(
    (d: Omit<ActiveDeployment, "status" | "hadImagePull">) => {
      setDeployments((prev) => [
        ...prev.filter((x) => x.jobId !== d.jobId),
        { ...d, status: "active", hadImagePull: false },
      ]);
    },
    []
  );

  const resolve = useCallback(
    (jobId: string, status: DeploymentLifecycle) => {
      setDeployments((prev) =>
        prev.map((d) => (d.jobId === jobId ? { ...d, status } : d))
      );
      onResolvedRef.current?.(jobId, status);
      if (status === "completed") {
        const timer = setTimeout(() => removeDeployment(jobId), COMPLETED_LINGER_MS);
        lingerTimersRef.current.push(timer);
      }
    },
    [removeDeployment]
  );

  // Poll every active job. Re-runs whenever the set of active jobs changes; each
  // job self-loops on a sequential timer and stops as soon as it goes terminal.
  const activeJobKey = deployments
    .filter((d) => d.status === "active")
    .map((d) => d.jobId)
    .join(",");

  useEffect(() => {
    const jobIds = activeJobKey ? activeJobKey.split(",") : [];
    if (jobIds.length === 0) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const notFoundCounts: Record<string, number> = {};

    const pollOnce = async (jobId: string) => {
      try {
        const res = await fetch(`/docker-api/deploy/progress/${jobId}/`);
        if (!res.ok) return;
        const data: DeploymentProgressData = await res.json();

        // Tolerate not_found briefly — a fresh job may not be registered yet.
        if (data.status === "not_found") {
          notFoundCounts[jobId] = (notFoundCounts[jobId] ?? 0) + 1;
          const started = deployments.find((d) => d.jobId === jobId)?.startedAt ?? 0;
          const withinGrace = Date.now() - started < NOT_FOUND_GRACE_MS;
          if (withinGrace && notFoundCounts[jobId] <= MAX_NOT_FOUND_RETRIES) return;
          resolve(jobId, "failed");
          return;
        }
        notFoundCounts[jobId] = 0;

        setProgressByJob((prev) => ({ ...prev, [jobId]: data }));
        if (data.stage === "pulling_image") {
          setDeployments((prev) =>
            prev.map((d) =>
              d.jobId === jobId && !d.hadImagePull ? { ...d, hadImagePull: true } : d
            )
          );
        }

        if (data.status === "completed") resolve(jobId, "completed");
        else if (TERMINAL_ERROR.has(data.status)) resolve(jobId, "failed");
      } catch {
        // Transient network error — keep polling.
      }
    };

    jobIds.forEach((jobId) => {
      const tick = async () => {
        if (cancelled) return;
        await pollOnce(jobId);
        if (cancelled) return;
        timers.push(setTimeout(tick, DEFAULT_DEPLOYMENT_PROGRESS_POLL_MS));
      };
      void tick();
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // deployments intentionally omitted: startedAt is read at fire time and the
    // key already re-runs the effect when the active set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobKey, resolve]);

  useEffect(() => {
    const timers = lingerTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const reservedDeviceIds = Array.from(
    new Set(
      deployments
        .filter((d) => d.status === "active")
        .flatMap((d) => d.deviceIds)
    )
  );

  return { deployments, progressByJob, addDeployment, removeDeployment, reservedDeviceIds };
}
