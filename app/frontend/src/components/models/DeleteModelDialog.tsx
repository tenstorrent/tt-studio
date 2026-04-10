// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
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
import type { DeleteStreamStatus, StepLogs } from "../../hooks/useDeleteStream";

export type DeleteStep = "deleting" | "resetting" | null;

interface Props {
  open: boolean;
  modelId: string;
  isLoading: boolean;
  deleteStep: DeleteStep;
  streamStatus: DeleteStreamStatus;
  stepLogs: StepLogs;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

type StepState = "pending" | "active" | "done" | "error";

function StepLogPanel({ logs }: { logs: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-stone-700/60 bg-stone-950/80 overflow-hidden">
      <div className="max-h-32 overflow-y-auto overflow-x-hidden px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-400 scrollbar-thin scrollbar-thumb-stone-700">
        {logs.map((line, i) => (
          <div
            key={i}
            className={`py-px break-all ${
              line.toLowerCase().includes("error") ||
              line.toLowerCase().includes("failed")
                ? "text-red-400"
                : line.toLowerCase().includes("success") ||
                    line.toLowerCase().includes("completed") ||
                    line.toLowerCase().includes("successfully")
                  ? "text-green-400"
                  : line.toLowerCase().includes("warning")
                    ? "text-yellow-400"
                    : ""
            }`}
          >
            {line}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function StepRow({
  number,
  icon,
  label,
  sublabel,
  state,
  logs,
}: {
  number: number;
  icon: ReactNode;
  label: string;
  sublabel?: string;
  state: StepState;
  logs: string[];
}) {
  return (
    <div
      className={`p-3 rounded-lg border transition-all duration-300 ${
        state === "active"
          ? "bg-blue-900/30 border-blue-500/40"
          : state === "done"
            ? "bg-green-900/20 border-green-600/30"
            : state === "error"
              ? "bg-red-900/20 border-red-600/30"
              : "bg-stone-800/50 border-stone-700/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 flex items-center justify-center shrink-0 mt-0.5">
          {state === "active" ? (
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          ) : state === "done" ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : state === "error" ? (
            <XCircle className="w-5 h-5 text-red-400" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-stone-600 flex items-center justify-center text-xs font-bold text-stone-300">
              {number}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`font-medium text-sm ${
              state === "pending"
                ? "text-stone-400"
                : state === "error"
                  ? "text-red-300"
                  : "text-white"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {icon}
              {label}
            </span>
          </div>
          {sublabel && state === "active" && (
            <div className="text-xs text-blue-300 mt-1">{sublabel}</div>
          )}
          {state === "done" && (
            <div className="text-xs text-green-400 mt-0.5">Completed</div>
          )}
          {state === "error" && (
            <div className="text-xs text-red-400 mt-0.5">Failed</div>
          )}
        </div>
      </div>

      {/* Per-step log output */}
      <StepLogPanel logs={logs} />
    </div>
  );
}

export default function DeleteModelDialog({
  open,
  modelId: _modelId,
  isLoading,
  deleteStep,
  streamStatus,
  stepLogs,
  errorMessage,
  onConfirm,
  onCancel,
}: Props) {
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
          <StepRow
            number={1}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            label="Stop & remove model container"
            sublabel="Sending stop signal to the container…"
            state={step1State}
            logs={stepLogs.deleting}
          />
          <StepRow
            number={2}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            label="Reset the board"
            sublabel="Running tt-smi -r, this may take 10–30 seconds…"
            state={step2State}
            logs={stepLogs.resetting}
          />
        </div>

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
