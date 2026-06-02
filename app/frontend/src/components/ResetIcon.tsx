// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Cpu,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Trash2,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useTheme } from "../hooks/useTheme";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { fetchModels, deleteModel } from "../api/modelsDeployedApis";
import { useModels } from "../hooks/useModels";
import { useDeviceState } from "../hooks/useDeviceState";
import BoardBadge from "./BoardBadge";
import MultiCardResetDialog from "./MultiCardResetDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

// Board types that have multiple individually-resettable chips
const MULTI_CHIP_BOARDS = new Set([
  "T3K", "T3000", "N150X4", "N300x4",
  "P150X4", "P150X8", "P300x2", "P300Cx4",
  "GALAXY", "GALAXY_T3K",
]);

type ResetStep = "deleting" | "resetting" | "done" | "failed" | null;

interface ResetIconProps {
  onReset?: () => void;
  forceOpen?: boolean;
}

// ── Shared step-row (mirrors DeleteModelDialog) ──────────────────────────────
function StepRow({
  number,
  icon,
  label,
  sublabel,
  state,
}: {
  number: number;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  state: "pending" | "active" | "done" | "skipped";
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${state === "active"
        ? "bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-500/40"
        : state === "done"
          ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-600/30"
          : state === "skipped"
            ? "bg-stone-50 border-stone-200 dark:bg-stone-800/30 dark:border-stone-700/30"
            : "bg-stone-50 border-stone-200 dark:bg-stone-800/50 dark:border-stone-700/40"
        }`}
    >
      <div className="w-7 h-7 flex items-center justify-center shrink-0 mt-0.5">
        {state === "active" ? (
          <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
        ) : state === "done" ? (
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
        ) : state === "skipped" ? (
          <CheckCircle className="w-5 h-5 text-stone-500" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-600 flex items-center justify-center text-xs font-bold text-stone-700 dark:text-stone-300">
            {number}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`font-medium text-sm inline-flex items-center gap-1.5 ${state === "pending" || state === "skipped"
            ? "text-stone-600 dark:text-stone-400"
            : "text-stone-950 dark:text-white"
            }`}
        >
          {icon}
          {label}
        </div>
        {sublabel && state === "active" && (
          <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">{sublabel}</div>
        )}
        {state === "done" && (
          <div className="text-xs text-green-700 dark:text-green-400 mt-0.5">Completed</div>
        )}
        {state === "skipped" && (
          <div className="text-xs text-stone-500 dark:text-stone-500 mt-0.5">
            No models deployed — skipped
          </div>
        )}
      </div>
    </div>
  );
}

// ── Board status banner ───────────────────────────────────────────────────────
function BoardStatusBanner({
  state,
  boardType,
}: {
  state: string;
  boardType: string;
}) {
  if (state === "BAD_STATE") {
    return (
      <div className="flex items-start gap-3 p-3 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-500/40 rounded-lg text-orange-900 dark:text-orange-200 text-sm">
        <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
        <div>
          <strong className="text-orange-700 dark:text-orange-300">Board unresponsive</strong>
          <p className="mt-0.5 text-orange-800/80 dark:text-orange-200/80">
            The board is present but not responding. A reset is strongly
            recommended.
          </p>
        </div>
      </div>
    );
  }
  if (state === "NOT_PRESENT") {
    return (
      <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/40 rounded-lg text-red-900 dark:text-red-200 text-sm">
        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
        <div>
          <strong className="text-red-700 dark:text-red-300">No device detected</strong>
          <p className="mt-0.5 text-red-800/80 dark:text-red-200/80">
            <code className="bg-red-100 dark:bg-red-900/50 px-1 rounded">/dev/tenstorrent</code>{" "}
            not found. Check your hardware connection.
          </p>
        </div>
      </div>
    );
  }
  if (state === "HEALTHY" && boardType !== "unknown") {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-600/30 rounded-lg text-green-900 dark:text-green-200 text-sm">
        <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
        <span>
          Board is <strong className="text-green-700 dark:text-green-300">healthy</strong> — reset
          is available if needed.
        </span>
      </div>
    );
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────
const ResetIcon: React.FC<ResetIconProps> = ({ onReset, forceOpen }) => {
  const { theme } = useTheme();
  const { models, refreshModels, isDeleteInFlight } = useModels();
  const { deviceState, refresh: refreshDeviceState } = useDeviceState();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isMultiCardOpen, setIsMultiCardOpen] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cmdOutput, setCmdOutput] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const [resetHistory, setResetHistory] = useState<Date[]>([]);

  const isLoading =
    resetStep === "deleting" || resetStep === "resetting";
  const isCompleted = resetStep === "done";
  const isFailed = resetStep === "failed";

  const boardType = deviceState?.board_type ?? "unknown";
  const deviceStateName = deviceState?.state ?? "UNKNOWN";
  const isMultiChip = MULTI_CHIP_BOARDS.has(boardType);
  const isBadState = deviceStateName === "BAD_STATE";
  const isNotPresent = deviceStateName === "NOT_PRESENT";
  const isResettingContext = deviceStateName === "RESETTING";
  const deployedCount = models.length;

  // Step states for the progress rows
  const step1State: "pending" | "active" | "done" | "skipped" =
    resetStep === "deleting"
      ? "active"
      : resetStep === "resetting" || resetStep === "done" || resetStep === "failed"
        ? deployedCount === 0
          ? "skipped"
          : "done"
        : "pending";

  const step2State: "pending" | "active" | "done" | "skipped" =
    resetStep === "resetting"
      ? "active"
      : resetStep === "done"
        ? "done"
        : "pending";

  // ── Reset execution ─────────────────────────────────────────────────────────
  const executeReset = async () => {
    setErrorMessage(null);
    setCmdOutput(null);
    setShowOutput(false);

    try {
      // Pass skip_device_reset to only stop containers, leaving whole board reset to run later.
      setResetStep("deleting");
      const currentModels = await fetchModels();
      await Promise.all(currentModels.map((m) => deleteModel(m.id, true)));
      await refreshModels();

      // Run the global board reset.
      setResetStep("resetting");
      const response = await axios.post<Blob>("/docker-api/reset_board/", null, {
        responseType: "blob",
      });

      const reader = response.data.stream().getReader();
      const decoder = new TextDecoder();
      let output = "";
      let success = true;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        output += chunk;
        if (
          chunk.includes("Command failed") ||
          chunk.includes("No Tenstorrent devices detected") ||
          chunk.includes("Error")
        ) {
          success = false;
        }
      }
      const tail = decoder.decode();
      if (tail) {
        output += tail;
        if (
          tail.includes("Command failed") ||
          tail.includes("No Tenstorrent devices detected") ||
          tail.includes("Error")
        ) {
          success = false;
        }
      }

      setCmdOutput(output);

      if (!success) {
        throw new Error(
          response.status === 501
            ? "No Tenstorrent devices detected. Check hardware connection."
            : "Board reset failed. See command output for details."
        );
      }

      setResetStep("done");
      setResetHistory((prev) => [...prev, new Date()]);
      refreshDeviceState();
      if (onReset) onReset();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "An unknown error occurred."
      );
      setResetStep("failed");
    }
  };

  const handleOpen = () => {
    if (isDeleteInFlight) return;
    if (isMultiChip) {
      setIsMultiCardOpen(true);
      return;
    }
    setIsDialogOpen(true);
    // Only reset state when there's nothing in progress — otherwise re-show current progress
    if (!isLoading) {
      setResetStep(null);
      setErrorMessage(null);
      setCmdOutput(null);
      setShowOutput(false);
    }
  };

  useEffect(() => {
    if (forceOpen) handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);

  const handleClose = () => {
    setIsDialogOpen(false);
    // Do NOT reset state — any in-progress reset continues in the background.
    // State is only cleared on the next fresh open (see handleOpen above).
  };

  // ── Navbar trigger button ───────────────────────────────────────────────────
  const iconColor = theme === "dark" ? "text-zinc-200" : "text-black";
  const hoverIconColor =
    theme === "dark" ? "hover:text-zinc-300" : "hover:text-gray-700";
  const btnBg = theme === "dark" ? "bg-zinc-900" : "bg-white";
  const btnHover =
    theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-gray-200";

  return (
    <>
      {/* Multi-chip board: show the per-device grid dialog */}
      <MultiCardResetDialog
        open={isMultiCardOpen}
        onOpenChange={setIsMultiCardOpen}
        onReset={onReset}
      />

      {/* Single-chip board: show the original single reset dialog */}
      <Dialog
        open={isDialogOpen && !isMultiChip}
        onOpenChange={(open) => (open ? handleOpen() : handleClose())}
      >
        <DialogTrigger asChild>
          {isDeleteInFlight ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    <Button
                      variant="navbar"
                      size="icon"
                      disabled
                      className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out ${btnBg} ${btnHover}`}
                    >
                      <Cpu className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-sm">
                    A model is currently being deleted. Please wait for it to finish before starting another destructive action.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Button
              variant="navbar"
              size="icon"
              className={`relative inline-flex items-center justify-center p-2 rounded-full transition-all duration-300 ease-in-out ${btnBg} ${btnHover}`}
              onClick={handleOpen}
            >
              {isLoading ? (
                <Spinner />
              ) : isCompleted ? (
                <CheckCircle className={`w-5 h-5 text-green-500`} />
              ) : (
                <>
                  <Cpu className={`w-5 h-5 ${iconColor} ${hoverIconColor}`} />
                  {/* Red dot if board is unhealthy */}
                  {(isBadState || isNotPresent) && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </>
              )}
            </Button>
          )}
        </DialogTrigger>

        <DialogContent
          className="sm:max-w-md p-6 rounded-xl shadow-2xl bg-white text-stone-950 border border-stone-200 backdrop-blur-md dark:bg-stone-900 dark:text-white dark:border-stone-700"
        >
          {/* ── HEADER ── */}
          <DialogHeader>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-3">
                {isLoading ? (
                  <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                  </div>
                ) : isCompleted ? (
                  <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                ) : isFailed ? (
                  <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center">
                    <RotateCcw className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                )}
                <div>
                  <DialogTitle className="text-base font-semibold text-stone-950 dark:text-white leading-tight">
                    {isLoading
                      ? resetStep === "deleting"
                        ? "Removing deployed models…"
                        : "Resetting board…"
                      : isCompleted
                        ? "Reset complete"
                        : isFailed
                          ? "Reset failed"
                          : "Reset Card"}
                  </DialogTitle>
                  {isLoading && (
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                      Step {resetStep === "deleting" ? "1" : "2"} of 2 — do not
                      close this window
                    </p>
                  )}
                </div>
              </div>
              {/* Board badge — only when idle */}
              {!isLoading && !isCompleted && !isFailed && boardType !== "unknown" && (
                <BoardBadge boardName={boardType} />
              )}
            </div>
          </DialogHeader>

          <div className="space-y-3 mt-3">
            {/* ── IDLE: board status + step overview ── */}
            {!isLoading && !isCompleted && !isFailed && (
              <>
                <BoardStatusBanner
                  state={deviceStateName}
                  boardType={boardType}
                />

                {isResettingContext && (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-500/40 rounded-lg text-blue-900 dark:text-blue-200 text-sm">
                    <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                    <span>Board is already resetting…</span>
                  </div>
                )}

                {/* Step overview */}
                <StepRow
                  number={1}
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  label={
                    deployedCount > 0
                      ? `Stop ${deployedCount} deployed model${deployedCount > 1 ? "s" : ""}`
                      : "Stop deployed models"
                  }
                  state="pending"
                />
                <StepRow
                  number={2}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  label="Reset the board (tt-smi -r)"
                  state="pending"
                />

                {/* Warning */}
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-500/25 rounded-lg text-red-900 dark:text-red-200 text-sm">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                  <span>
                    <strong className="text-red-700 dark:text-red-300">Warning:</strong> This will
                    interrupt any ongoing processes on the card.
                    {resetHistory.length > 0 && (
                      <span className="block mt-1 text-red-700/70 dark:text-red-300/70">
                        Last reset:{" "}
                        {resetHistory[resetHistory.length - 1].toLocaleTimeString()}
                      </span>
                    )}
                  </span>
                </div>
              </>
            )}

            {/* ── LOADING: step progress ── */}
            {isLoading && (
              <>
                <StepRow
                  number={1}
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  label={
                    deployedCount > 0
                      ? `Stop ${deployedCount} deployed model${deployedCount > 1 ? "s" : ""}`
                      : "Stop deployed models"
                  }
                  sublabel="Sending stop signal to all containers…"
                  state={step1State}
                />
                <StepRow
                  number={2}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  label="Reset the board"
                  sublabel="Running tt-smi -r, this may take 10–30 seconds…"
                  state={step2State}
                />
              </>
            )}

            {/* ── COMPLETED ── */}
            {isCompleted && (
              <>
                <StepRow
                  number={1}
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  label="Deployed models removed"
                  state={deployedCount === 0 ? "skipped" : "done"}
                />
                <StepRow
                  number={2}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  label="Board reset"
                  state="done"
                />
                {cmdOutput && (
                  <button
                    type="button"
                    onClick={() => setShowOutput((v) => !v)}
                    className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 transition-colors"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showOutput ? "rotate-180" : ""}`}
                    />
                    {showOutput ? "Hide" : "Show"} command output
                  </button>
                )}
                {showOutput && cmdOutput && (
                  <ScrollArea className="h-36 rounded-lg border border-stone-200 dark:border-stone-700">
                    <pre className="p-3 text-xs text-green-700 dark:text-green-400 whitespace-pre-wrap font-mono bg-stone-50 dark:bg-stone-950">
                      {cmdOutput}
                    </pre>
                  </ScrollArea>
                )}
              </>
            )}

            {/* ── FAILED ── */}
            {isFailed && (
              <>
                <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/40 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      {errorMessage}
                    </p>
                    {cmdOutput && (
                      <button
                        type="button"
                        onClick={() => setShowOutput((v) => !v)}
                        className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 mt-2 transition-colors"
                      >
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${showOutput ? "rotate-180" : ""}`}
                        />
                        {showOutput ? "Hide" : "Show"} command output
                      </button>
                    )}
                  </div>
                </div>
                {showOutput && cmdOutput && (
                  <ScrollArea className="h-36 rounded-lg border border-stone-200 dark:border-stone-700">
                    <pre className="p-3 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono bg-stone-50 dark:bg-stone-950">
                      {cmdOutput}
                    </pre>
                  </ScrollArea>
                )}
              </>
            )}
          </div>

          {/* ── FOOTER ── */}
          <DialogFooter className="mt-5 flex justify-end gap-2">
            {(isCompleted || isFailed) ? (
              <Button
                variant="outline"
                onClick={handleClose}
                className="border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  className="border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {isLoading ? "Minimize" : "Cancel"}
                </Button>
                <Button
                  onClick={executeReset}
                  disabled={isLoading || isResettingContext || isNotPresent}
                  className={`min-w-[120px] border ${isBadState
                    ? "bg-orange-600 hover:bg-orange-700 border-orange-500/40 text-white"
                    : "bg-red-600 hover:bg-red-700 border-red-500/30 text-white"
                    }`}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing…
                    </span>
                  ) : isBadState ? (
                    "Reset (Recommended)"
                  ) : (
                    "Reset Card"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ResetIcon;
