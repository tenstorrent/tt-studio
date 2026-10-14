// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useState } from "react";
import { deleteModel, streamResetAction } from "../api/modelsDeployedApis";
import type { BoardDevice } from "./useBoardCards";
import { useDeviceState } from "./useDeviceState";
import { useIsResetting } from "./useIsResetting";
import { useRefresh } from "./useRefresh";

export type ResetDeviceState = "idle" | "resetting" | "success" | "error";

export interface UseResetDeviceResult {
  state: ResetDeviceState;
  error: string | null;
  canReset: boolean;
  disabledReason: string | null;
  reset: () => Promise<boolean>;
}

export function useResetDevice(device: BoardDevice): UseResetDeviceResult {
  const { refresh: refreshDeviceState } = useDeviceState();
  const isResetting = useIsResetting();
  const { triggerRefresh } = useRefresh();
  const [state, setState] = useState<ResetDeviceState>("idle");
  const [error, setError] = useState<string | null>(null);

  const disabledReason = useMemo(() => {
    if (state === "resetting") {
      return "Reset in progress.";
    }

    if (isResetting) {
      return "A reset is already in progress.";
    }

    const deployment = device.deployment;
    if (!deployment) return null;

    if (deployment.source === "external") {
      return "Reset unavailable for devices occupied by external containers.";
    }

    if (deployment.source === "pending") {
      return "Reset unavailable while a deployment is still starting.";
    }

    if (!deployment.containerId) {
      return "Reset unavailable until deployment metadata finishes loading.";
    }

    return null;
  }, [device.deployment, isResetting, state]);

  const reset = useCallback(async (): Promise<boolean> => {
    if (disabledReason) return false;

    setState("resetting");
    setError(null);
    refreshDeviceState();
    triggerRefresh();

    try {
      const deployment = device.deployment;
      if (deployment?.source === "managed") {
        await deleteModel(deployment.containerId!, false);
      } else {
        const { status, message } = await streamResetAction(
          `/docker-api/reset_device/stream/${device.id}/`
        );
        if (status !== "success") {
          throw new Error(message || "Device reset failed.");
        }
      }

      setState("success");
      refreshDeviceState();
      triggerRefresh();
      return true;
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Device reset failed.");
      refreshDeviceState();
      triggerRefresh();
      return false;
    }
  }, [device.deployment, device.id, disabledReason, refreshDeviceState, triggerRefresh]);

  return {
    state,
    error,
    canReset: disabledReason === null,
    disabledReason,
    reset,
  };
}
