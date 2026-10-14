// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useState } from "react";
import {
  getResetAllStatus,
  startResetAll,
} from "../api/modelsDeployedApis";
import { useDeviceState } from "./useDeviceState";
import { useIsResetting } from "./useIsResetting";
import { useRefresh } from "./useRefresh";

export type ResetBoardState = "idle" | "resetting" | "success" | "error";

export interface UseResetBoardResult {
  state: ResetBoardState;
  error: string | null;
  canReset: boolean;
  disabledReason: string | null;
  reset: () => Promise<boolean>;
}

const POLL_INTERVAL_MS = 2000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function useResetBoard(): UseResetBoardResult {
  const { refresh: refreshDeviceState } = useDeviceState();
  const isResetting = useIsResetting();
  const { triggerRefresh, triggerResetAll } = useRefresh();
  const [state, setState] = useState<ResetBoardState>("idle");
  const [error, setError] = useState<string | null>(null);

  const disabledReason =
    state === "resetting"
      ? "Reset in progress."
      : isResetting
        ? "A reset is already in progress."
        : null;

  const reset = useCallback(async (): Promise<boolean> => {
    if (disabledReason) return false;

    setState("resetting");
    setError(null);
    refreshDeviceState();
    triggerRefresh();

    try {
      await startResetAll();

      for (;;) {
        await sleep(POLL_INTERVAL_MS);
        const status = await getResetAllStatus();
        if (!status.done) {
          refreshDeviceState();
          triggerRefresh();
          continue;
        }
        if (!status.ok) {
          throw new Error(status.error || "Board reset failed.");
        }
        break;
      }

      setState("success");
      refreshDeviceState();
      triggerRefresh();
      triggerResetAll();
      return true;
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Board reset failed.");
      refreshDeviceState();
      triggerRefresh();
      return false;
    }
  }, [disabledReason, refreshDeviceState, triggerRefresh, triggerResetAll]);

  return {
    state,
    error,
    canReset: disabledReason === null,
    disabledReason,
    reset,
  };
}
