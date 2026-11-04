// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useQueries } from "@tanstack/react-query";
import type { StartupPhase } from "@/src/components/HealthBadge";

export type ModelHealthStatus =
  | "healthy"
  | "starting"
  | "unavailable"
  | "unknown";

export interface ModelHealth {
  status: ModelHealthStatus;
  /** Warm-up phase reported while the model is starting (HTTP 202) */
  phase: StartupPhase | null;
}

/**
 * Probe a deployment's readiness. 200 = ready to serve, 202 = still warming up
 * (with the current startup phase), 503 = unavailable.
 */
async function fetchModelHealth(deployId: string): Promise<ModelHealth> {
  try {
    const response = await fetch(`/models-api/health/?deploy_id=${deployId}`);
    if (response.status === 200) return { status: "healthy", phase: null };
    if (response.status === 202) {
      let phase: StartupPhase | null = null;
      try {
        phase = ((await response.json())?.phase as StartupPhase) ?? null;
      } catch {
        phase = null;
      }
      return { status: "starting", phase };
    }
    if (response.status === 503) return { status: "unavailable", phase: null };
    return { status: "unknown", phase: null };
  } catch {
    return { status: "unknown", phase: null };
  }
}

/**
 * Readiness of each deployed container, polled quickly until a model reports
 * healthy and slowly afterwards. Results are shared through the query cache, so
 * every caller polling the same container shares one request. A container's
 * entry is undefined until its first check comes back.
 */
export function useModelHealth(containerIds: string[]) {
  const results = useQueries({
    queries: containerIds.map((id) => ({
      queryKey: ["model-health", id],
      queryFn: () => fetchModelHealth(id),
      refetchInterval: (query: { state: { data?: ModelHealth } }) =>
        query.state.data?.status === "healthy" ? 30_000 : 3_000,
      staleTime: 1_000,
    })),
  });

  const healthById: Record<string, ModelHealth | undefined> = {};
  containerIds.forEach((id, index) => {
    healthById[id] = results[index]?.data;
  });
  return healthById;
}
