// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  AlertTriangle,
  CheckCircle,
  Cpu,
  Loader2,
  Minimize2,
  Trash2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import BoardBadge from "../BoardBadge";
import ResetStepRow from "../ResetStepRow";
import type { DeleteStreamStatus, StepLogs } from "../../hooks/useDeleteStream";

export type DeleteStep = "deleting" | "resetting" | null;

interface Props {
  open: boolean;
  modelId: string;
  deviceIds?: number[];
  totalDevices?: number;
  boardType?: string;
  isLoading: boolean;
  deleteStep: DeleteStep;
  streamStatus: DeleteStreamStatus;
  stepLogs: StepLogs;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onMinimize?: () => void;
}

function DeviceScopeDiagram({
  deviceIds,
  totalDevices,
  boardType,
  active,
}: {
  deviceIds: number[];
  totalDevices: number;
  boardType?: string;
  active: boolean;
}) {
  const affected = new Set(deviceIds);
  const count = deviceIds.length;
  return (
    <div className="mt-3 rounded-lg border border-stone-700/60 bg-stone-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-stone-300">
          Resetting{" "}
          <span className="text-amber-300 font-semibold">{count}</span>{" "}
          of{" "}
          <span className="text-stone-200 font-semibold">{totalDevices}</span>{" "}
          device{totalDevices !== 1 ? "s" : ""}
        </div>
        {boardType && <BoardBadge boardName={boardType} />}
      </div>
      <div
        className="grid gap-1.5"
        style={{
          gridTemplateColumns: `repeat(${Math.min(totalDevices, 4)}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: totalDevices }).map((_, i) => {
          const isAffected = affected.has(i);
          return (
            <div
              key={i}
              className={`relative aspect-square rounded-md border flex flex-col items-center justify-center transition-all ${
                isAffected
                  ? active
                    ? "border-amber-400/70 bg-amber-500/15 shadow-[0_0_0_1px_rgba(251,191,36,0.25)]"
                    : "border-amber-500/50 bg-amber-500/10"
                  : "border-stone-700/60 bg-stone-900/60"
              }`}
            >
              <Cpu
                className={`w-4 h-4 ${
                  isAffected
                    ? active
                      ? "text-amber-300 animate-pulse"
                      : "text-amber-400"
                    : "text-stone-600"
                }`}
              />
              <div
                className={`text-[10px] mt-0.5 font-mono ${
                  isAffected ? "text-amber-200" : "text-stone-500"
                }`}
              >
                {i.toString().padStart(2, "0")}
              </div>
              {isAffected && (
                <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-amber-500/60 border border-amber-400/70" />
          Will reset
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-stone-800 border border-stone-700" />
          Untouched
        </span>
      </div>
    </div>
  );
}

type StepState = "pending" | "active" | "done" | "error";

export default function DeleteModelDialog({
  open,
  modelId: _modelId,
  deviceIds,
  totalDevices,
  boardType,
  isLoading,
  deleteStep,
  streamStatus,
  stepLogs,
  errorMessage,
  onConfirm,
  onCancel,
  onMinimize,
}: Props) {
  const resetStepLabel =
    deviceIds && deviceIds.length > 0
      ? `Reset this model's devices (tt-smi -r ${deviceIds.join(",")})`
      : "Reset this model's devices (tt-smi -r)";
  const isDone = streamStatus === "success" || streamStatus === "partial";
  const isError = streamStatus === "error";

  const step1State: StepState =
    isError && deleteStep === "deleting"
      ? "error"
      : deleteStep === "deleting"
        ? "active"
        : deleteStep === "resetting" || isDone
          ? "done"
          : "pending";

  const step2State: StepState =
    isError && deleteStep === "resetting"
      ? "error"
      : streamStatus === "partial"
        ? "error"
        : deleteStep === "resetting"
          ? "active"
          : isDone
            ? "done"
            : "pending";

  const canClose = !isLoading || isDone || isError;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && canClose && onCancel()}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto p-6 rounded-xl shadow-2xl bg-stone-900 text-white border border-stone-700 backdrop-blur-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            {isLoading && !isDone && !isError ? (
              <div className="w-9 h-9 rounded-full bg-blue-900/50 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
              </div>
            ) : isDone ? (
              <div className="w-9 h-9 rounded-full bg-green-900/50 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-400" />
              </div>
            ) : isError ? (
              <div className="w-9 h-9 rounded-full bg-red-900/50 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-400" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-full bg-yellow-900/50 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
              </div>
            )}
            <div>
              <DialogTitle className="text-base font-semibold text-white leading-tight">
                {isDone
                  ? "Deletion Complete"
                  : isError
                    ? "Deletion Failed"
                    : isLoading
                      ? deleteStep === "deleting"
                        ? "Removing model…"
                        : "Resetting board…"
                      : "Delete Model & Reset Card"}
              </DialogTitle>
              {isLoading && !isDone && !isError && (
                <p className="text-xs text-stone-400 mt-0.5">
                  Step {deleteStep === "deleting" ? "1" : "2"} of 2 — do not
                  close this window
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2 mt-2">
          <ResetStepRow
            number={1}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Stop & remove model container"
            sublabel="Sending stop signal to the container…"
            state={step1State}
            logs={stepLogs.deleting}
          />
          <ResetStepRow
            number={2}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label={resetStepLabel}
            sublabel="Running tt-smi -r, this may take 10–30 seconds…"
            state={step2State}
            logs={stepLogs.resetting}
          />
        </div>

        {deviceIds && deviceIds.length > 0 && totalDevices && totalDevices > 1 && (
          <DeviceScopeDiagram
            deviceIds={deviceIds}
            totalDevices={totalDevices}
            boardType={boardType}
            active={step2State === "active"}
          />
        )}

        {/* Error banner */}
        {isError && errorMessage && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-950/40 rounded-lg border border-red-500/25 text-red-200 text-sm">
            <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <span>
              {errorMessage}
              {" — "}check the logs above for details. You may need to retry or
              reset the board manually.
            </span>
          </div>
        )}

        {/* Warning — only shown when idle */}
        {!isLoading && !isDone && !isError && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-red-950/40 rounded-lg border border-red-500/25 text-red-200 text-sm">
            <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <span>
              <strong className="text-red-300">Warning:</strong> This will
              interrupt any ongoing processes on the card and cannot be undone.
            </span>
          </div>
        )}

        <DialogFooter className="mt-5 flex justify-end gap-2">
          {isDone || isError ? (
            <Button
              onClick={onCancel}
              className="border-stone-600 text-stone-300 hover:bg-stone-800"
            >
              Close
            </Button>
          ) : isLoading && onMinimize ? (
            <Button
              variant="outline"
              onClick={onMinimize}
              className="border-stone-600 text-stone-300 hover:bg-stone-800"
            >
              <span className="flex items-center gap-2">
                <Minimize2 className="w-4 h-4" />
                Run in background
              </span>
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={isLoading}
                className="border-stone-600 text-stone-300 hover:bg-stone-800"
              >
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                disabled={isLoading}
                className="bg-red-600 text-white hover:bg-red-700 border border-red-500/30 min-w-[130px]"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing…
                  </span>
                ) : (
                  "Delete & Reset"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
