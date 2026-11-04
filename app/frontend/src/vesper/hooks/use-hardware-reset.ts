// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getResetAllStatus,
  startResetAll,
  streamResetAction,
} from "@/src/api/modelsDeployedApis";
import { useModels } from "@/src/hooks/useModels";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import { useRefresh } from "@/src/hooks/useRefresh";
import { getErrorMessage } from "@/src/utils/errors";
import { CHIP_STATUS_QUERY_KEY } from "./use-chip-status";

export type ResetStep = "idle" | "stopping" | "resetting" | "done" | "failed";

export interface ResetProgress {
  step: ResetStep;
  output: string;
  error: string | null;
}

const IDLE: ResetProgress = { step: "idle", output: "", error: null };

/**
 * A unit that can be reset: a deployed model (stopped, then all of its devices
 * reset as one) or a single free device slot.
 */
export type ResetTarget =
  | { kind: "model"; containerId: string; slots: number[] }
  | { kind: "slot"; slot: number };

export function resetTargetKey(target: ResetTarget) {
  return target.kind === "model"
    ? `model:${target.containerId}`
    : `slot:${target.slot}`;
}

/**
 * Drives device and board resets, tracking progress per target. Mirrors the
 * behaviour of the original multi-card reset dialog: a model target streams its
 * stop + reset, a free slot streams `tt-smi -r`, and a full board reset runs as
 * a backend job that is polled until done.
 */
export function useHardwareReset() {
  const queryClient = useQueryClient();
  const { refreshModels } = useModels();
  const { refresh: refreshDeviceState } = useDeviceState();
  const { triggerResetAll } = useRefresh();

  const [targets, setTargets] = useState<Record<string, ResetProgress>>({});
  const [board, setBoard] = useState<ResetProgress>(IDLE);

  const afterReset = useCallback(() => {
    refreshModels();
    refreshDeviceState();
    queryClient.invalidateQueries({ queryKey: CHIP_STATUS_QUERY_KEY });
  }, [refreshModels, refreshDeviceState, queryClient]);

  const resetTarget = useCallback(
    async (target: ResetTarget) => {
      const key = resetTargetKey(target);
      const patch = (next: Partial<ResetProgress>) =>
        setTargets((prev) => ({
          ...prev,
          [key]: { ...(prev[key] ?? IDLE), ...next },
        }));

      patch({
        step: target.kind === "model" ? "stopping" : "resetting",
        output: "",
        error: null,
      });

      const url =
        target.kind === "model"
          ? `/docker-api/stop/stream/${target.containerId}/`
          : `/docker-api/reset_device/stream/${target.slot}/`;

      let output = "";
      try {
        const { status, message } = await streamResetAction(
          url,
          (line) => {
            output += `${line}\n`;
            patch({ output });
          },
          (step) => {
            if (step === "deleting") patch({ step: "stopping" });
            if (step === "resetting") patch({ step: "resetting" });
          }
        );
        if (status !== "success") {
          throw new Error(
            message || "Reset failed. See the output for details."
          );
        }
        patch({ step: "done", output });
        return true;
      } catch (err) {
        patch({ step: "failed", error: getErrorMessage(err) });
        return false;
      } finally {
        afterReset();
      }
    },
    [afterReset]
  );

  const resetBoard = useCallback(async () => {
    setBoard({ step: "stopping", output: "", error: null });
    try {
      // runs as a backend job: it stops every model before resetting the board
      await startResetAll();
      refreshDeviceState();
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await getResetAllStatus();
        setBoard((prev) => ({
          ...prev,
          step:
            status.step === "deleting"
              ? "stopping"
              : status.step === "resetting"
                ? "resetting"
                : prev.step,
          output: status.logs.join("\n"),
        }));
        if (status.done) {
          if (!status.ok) {
            throw new Error(
              status.error || "Board reset failed. See the output for details."
            );
          }
          break;
        }
      }
      setBoard((prev) => ({ ...prev, step: "done" }));
      // views drop rows for containers that died before the reset
      triggerResetAll();
      return true;
    } catch (err) {
      setBoard((prev) => ({
        ...prev,
        step: "failed",
        error: getErrorMessage(err),
      }));
      return false;
    } finally {
      afterReset();
    }
  }, [afterReset, refreshDeviceState, triggerResetAll]);

  const clear = useCallback(() => {
    setTargets({});
    setBoard(IDLE);
  }, []);

  const isRunning =
    board.step === "stopping" ||
    board.step === "resetting" ||
    Object.values(targets).some(
      (t) => t.step === "stopping" || t.step === "resetting"
    );

  return {
    targets,
    board,
    isRunning,
    resetTarget,
    resetBoard,
    getProgress: (target: ResetTarget) =>
      targets[resetTargetKey(target)] ?? IDLE,
    clear,
  };
}
