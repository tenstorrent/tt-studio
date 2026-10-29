// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChipStatus } from "@/src/types/chipStatus";
import { useActiveDeploymentsContext } from "@/src/providers/ActiveDeploymentsContext";
import type { ActiveDeployment } from "@/src/hooks/useActiveDeployments";
import { useRefresh } from "@/src/hooks/useRefresh";

export const CHIP_STATUS_QUERY_KEY = ["chip-status"];

/**
 * Chip status with the slots that in-flight deploys have reserved marked as
 * occupied: the backend only reserves some of them once an image pull ends.
 */
export function withReservations(
  data: ChipStatus | undefined,
  deployments: ActiveDeployment[],
  reservedDeviceIds: number[]
): ChipStatus | null {
  if (!data || reservedDeviceIds.length === 0) return data ?? null;
  const reserved = new Set(reservedDeviceIds);
  const nameByDevice = new Map<number, string>();
  deployments
    .filter((d) => d.status === "active")
    .forEach((d) =>
      d.deviceIds.forEach((id) => {
        if (!nameByDevice.has(id)) nameByDevice.set(id, d.modelName);
      })
    );
  return {
    ...data,
    slots: data.slots.map((slot) =>
      reserved.has(slot.slot_id) && slot.status !== "occupied"
        ? {
            ...slot,
            status: "occupied" as const,
            model_name: slot.model_name ?? nameByDevice.get(slot.slot_id),
          }
        : slot
    ),
  };
}

async function fetchChipStatus() {
  const { data } = await axios.get<ChipStatus>("/docker-api/chip-status/");
  return data;
}

/**
 * Device slot occupancy, with slots claimed by in-flight deploys overlaid as
 * occupied so the catalog greys out configurations a pending deploy already
 * holds, before the backend has caught up.
 */
export function useChipStatus() {
  const queryClient = useQueryClient();
  const { deployments, reservedDeviceIds } = useActiveDeploymentsContext();
  const { refreshTrigger, resetAllNonce } = useRefresh();
  const hasActiveDeployments = deployments.some((d) => d.status === "active");

  const query = useQuery({
    queryKey: CHIP_STATUS_QUERY_KEY,
    queryFn: fetchChipStatus,
    refetchInterval: hasActiveDeployments ? 5_000 : 30_000,
    staleTime: 2_000,
  });

  // a slot is freed when a deploy fails, and claimed when one completes
  const deploymentSignature = deployments
    .map((d) => `${d.jobId}:${d.status}`)
    .join(",");
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: CHIP_STATUS_QUERY_KEY });
  }, [deploymentSignature, refreshTrigger, resetAllNonce, queryClient]);

  const chipStatus = useMemo(
    () => withReservations(query.data, deployments, reservedDeviceIds),
    [query.data, reservedDeviceIds, deployments]
  );

  return {
    chipStatus,
    isLoading: query.isPending,
    refetch: query.refetch,
  };
}
