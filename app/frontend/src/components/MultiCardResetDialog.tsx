// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useCallback, useEffect } from "react";
import axios from "axios";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Trash2,
  RotateCcw,
  ChevronDown,
  RefreshCw,
  Cpu,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { fetchModels, deleteModel } from "../api/modelsDeployedApis";
import { useModels } from "../hooks/useModels";
import { useDeviceState } from "../hooks/useDeviceState";
import BoardBadge from "./BoardBadge";

// ── Types ─────────────────────────────────────────────────────────────────────

type DeviceStep = "idle" | "deleting" | "resetting" | "done" | "failed";

interface DeviceResetState {
  step: DeviceStep;
  error: string | null;
  cmdOutput: string | null;
  showOutput: boolean;
}

export interface ChipSlot {
  slot_id: number;
  status: "occupied" | "available";
  model_name?: string;
  deployment_id?: number;
  is_multi_chip?: boolean;
  port?: number;
}

export interface ChipStatusData {
  board_type: string;
  total_slots: number;
  slots: ChipSlot[];
}

export type ChipStatusFetchState =
  | { status: "loading" }
  | { status: "success"; data: ChipStatusData; fetchedAt: Date }
  | { status: "error"; message: string };

interface MultiCardResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset?: () => void;
}

// ── Shared step-row ───────────────────────────────────────────────────────────
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
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${
        state === "active"
          ? "bg-blue-900/30 border-blue-500/40"
          : state === "done"
            ? "bg-green-900/20 border-green-600/30"
            : state === "skipped"
              ? "bg-stone-800/30 border-stone-700/30"
              : "bg-stone-800/50 border-stone-700/40"
      }`}
    >
      <div className="w-7 h-7 flex items-center justify-center shrink-0 mt-0.5">
        {state === "active" ? (
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
        ) : state === "done" ? (
          <CheckCircle className="w-5 h-5 text-green-400" />
        ) : state === "skipped" ? (
          <CheckCircle className="w-5 h-5 text-stone-500" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-stone-600 flex items-center justify-center text-xs font-bold text-stone-300">
            {number}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`font-medium text-sm inline-flex items-center gap-1.5 ${
            state === "pending" || state === "skipped" ? "text-stone-400" : "text-white"
          }`}
        >
          {icon}
          {label}
        </div>
        {sublabel && state === "active" && (
          <div className="text-xs text-blue-300 mt-1">{sublabel}</div>
        )}
        {state === "done" && (
          <div className="text-xs text-green-400 mt-0.5">Completed</div>
        )}
        {state === "skipped" && (
          <div className="text-xs text-stone-500 mt-0.5">No model deployed — skipped</div>
        )}
      </div>
    </div>
  );
}

// ── Model info section shown per card ─────────────────────────────────────────
function ModelInfo({
  slot,
  fetchState,
}: {
  slot: ChipSlot;
  fetchState: ChipStatusFetchState;
}) {
  if (fetchState.status === "loading") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-stone-400 animate-pulse mt-1.5">
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
        <span>Checking deployed models…</span>
      </div>
    );
  }

  if (fetchState.status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-yellow-400 mt-1.5">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Model info unavailable — proceed with caution</span>
      </div>
    );
  }

  if (slot.status === "occupied" && slot.model_name) {
    const portLabel = slot.port ? ` · port ${slot.port}` : "";
    const multiLabel = slot.is_multi_chip ? " · all chips" : "";
    return (
      <div className="mt-1.5 space-y-0.5">
        <div className="text-xs text-stone-500">Will stop:</div>
        <div className="flex items-start gap-1.5 text-xs text-amber-300">
          <Trash2 className="w-3 h-3 shrink-0 mt-0.5" />
          <span className="font-medium break-words min-w-0">
            {slot.model_name}
            <span className="text-stone-400 font-normal whitespace-nowrap">{portLabel}{multiLabel}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-stone-500 mt-1.5">
      <CheckCircle className="w-3 h-3 shrink-0" />
      <span>No model deployed</span>
    </div>
  );
}

// ── Individual device card ─────────────────────────────────────────────────────
function DeviceCard({
  slot,
  deviceState: ds,
  fetchState,
  onReset,
  onToggleOutput,
  isAnyResetting,
}: {
  slot: ChipSlot;
  deviceState: DeviceResetState;
  fetchState: ChipStatusFetchState;
  onReset: (slotId: number) => void;
  onToggleOutput: (slotId: number) => void;
  isAnyResetting: boolean;
}) {
  const { step, error, cmdOutput, showOutput } = ds;
  const isActive = step === "deleting" || step === "resetting";
  const isDone = step === "done";
  const isFailed = step === "failed";
  const isIdle = step === "idle";
  const hasModel = slot.status === "occupied" && !!slot.model_name;

  const step1State: "pending" | "active" | "done" | "skipped" =
    step === "deleting"
      ? "active"
      : step === "resetting" || step === "done" || step === "failed"
        ? hasModel ? "done" : "skipped"
        : "pending";

  const step2State: "pending" | "active" | "done" | "skipped" =
    step === "resetting" ? "active" : step === "done" ? "done" : "pending";

  const borderCls = isActive
    ? "border-blue-500/40"
    : isDone
      ? "border-green-600/30"
      : isFailed
        ? "border-red-500/40"
        : slot.status === "occupied"
          ? "border-amber-500/25"
          : "border-stone-700/40";

  const bgCls = isActive
    ? "bg-blue-900/10"
    : isDone
      ? "bg-green-900/10"
      : isFailed
        ? "bg-red-900/10"
        : "bg-stone-800/60";

  const statusLabel = isDone
    ? "Reset complete"
    : isFailed
      ? "Reset failed"
      : isActive
        ? step === "deleting" ? "Stopping model…" : "Resetting chip…"
        : slot.status === "occupied"
          ? "Model running"
          : "Available";

  const statusColor = isDone
    ? "text-green-400"
    : isFailed
      ? "text-red-400"
      : isActive
        ? "text-blue-400"
        : slot.status === "occupied"
          ? "text-amber-400"
          : "text-stone-500";

  return (
    <div className={`flex flex-col rounded-xl border p-5 transition-all duration-300 ${bgCls} ${borderCls}`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              isActive
                ? "bg-blue-900/50"
                : isDone
                  ? "bg-green-900/50"
                  : isFailed
                    ? "bg-red-900/50"
                    : "bg-stone-700/50"
            }`}
          >
            {isActive ? (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            ) : isDone ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : isFailed ? (
              <XCircle className="w-4 h-4 text-red-400" />
            ) : (
              <Cpu className="w-4 h-4 text-stone-300" />
            )}
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Device {slot.slot_id}</div>
            <div className={`text-xs ${statusColor}`}>{statusLabel}</div>
          </div>
        </div>

        {isIdle && (
          <Button
            size="sm"
            onClick={() => onReset(slot.slot_id)}
            disabled={isAnyResetting || fetchState.status === "loading"}
            className="text-xs h-7 px-2.5 bg-red-700/80 hover:bg-red-600 border border-red-500/30 text-white disabled:opacity-40"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Model info — shown when idle */}
      {isIdle && <ModelInfo slot={slot} fetchState={fetchState} />}

      {/* Progress steps — during/after reset */}
      {(isActive || isDone || isFailed) && (
        <div className="space-y-2.5 mt-3">
          <StepRow
            number={1}
            icon={<Trash2 className="w-3 h-3" />}
            label={hasModel ? `Stop ${slot.model_name}` : "Stop model"}
            sublabel="Sending stop signal…"
            state={step1State}
          />
          <StepRow
            number={2}
            icon={<RotateCcw className="w-3 h-3" />}
            label={`Reset chip (tt-smi -r ${slot.slot_id})`}
            sublabel="Running chip reset, may take 10–30s…"
            state={step2State}
          />
        </div>
      )}

      {/* Error detail */}
      {isFailed && error && (
        <div className="mt-2 p-2 rounded bg-red-900/30 border border-red-500/30 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Output toggle */}
      {(isDone || isFailed) && cmdOutput && (
        <>
          <button
            type="button"
            onClick={() => onToggleOutput(slot.slot_id)}
            className="mt-2 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 transition-colors"
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showOutput ? "rotate-180" : ""}`}
            />
            {showOutput ? "Hide" : "Show"} output
          </button>
          {showOutput && (
            <ScrollArea className="mt-1 h-24 rounded border border-stone-700">
              <pre
                className={`p-2 text-xs whitespace-pre-wrap font-mono bg-stone-950 ${
                  isDone ? "text-green-400" : "text-red-300"
                }`}
              >
                {cmdOutput}
              </pre>
            </ScrollArea>
          )}
        </>
      )}
    </div>
  );
}

// ── Main exported component ───────────────────────────────────────────────────
const MultiCardResetDialog: React.FC<MultiCardResetDialogProps> = ({
  open,
  onOpenChange,
  onReset,
}) => {
  const { refreshModels } = useModels();
  const { deviceState, refresh: refreshDeviceState } = useDeviceState();

  const boardType = deviceState?.board_type ?? "unknown";
  const deviceStateName = deviceState?.state ?? "UNKNOWN";

  const [deviceStates, setDeviceStates] = useState<Record<number, DeviceResetState>>({});
  const [boardStep, setBoardStep] = useState<
    "idle" | "deleting" | "resetting" | "done" | "failed" | null
  >(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardOutput, setBoardOutput] = useState<string | null>(null);
  const [showBoardOutput, setShowBoardOutput] = useState(false);
  const [chipFetch, setChipFetch] = useState<ChipStatusFetchState>({ status: "loading" });

  const fetchChipStatus = useCallback(async () => {
    setChipFetch({ status: "loading" });
    try {
      const res = await fetch("/docker-api/chip-status/");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ChipStatusData = await res.json();
      setChipFetch({ status: "success", data, fetchedAt: new Date() });
    } catch (err) {
      setChipFetch({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to fetch chip status",
      });
    }
  }, []);

  // Re-fetch and reset local state when dialog opens (but not while in-progress)
  useEffect(() => {
    if (!open) return;
    const anyActive = Object.values(deviceStates).some(
      (s) => s.step === "deleting" || s.step === "resetting"
    );
    const boardActive = boardStep === "deleting" || boardStep === "resetting";
    if (!anyActive && !boardActive) {
      setDeviceStates({});
      setBoardStep(null);
      setBoardError(null);
      setBoardOutput(null);
      setShowBoardOutput(false);
    }
    fetchChipStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const isAnyDeviceResetting = Object.values(deviceStates).some(
    (s) => s.step === "deleting" || s.step === "resetting"
  );
  const isBoardResetting = boardStep === "deleting" || boardStep === "resetting";
  const isAnyResetting = isAnyDeviceResetting || isBoardResetting;
  const isResettingContext = deviceStateName === "RESETTING";

  // ── Helpers for streaming reset output ──────────────────────────────────────
  const readStreamOutput = async (blob: Blob): Promise<{ output: string; success: boolean }> => {
    const reader = blob.stream().getReader();
    const decoder = new TextDecoder();
    let output = "";
    let success = true;
    const failMarkers = ["Command failed", "No Tenstorrent devices detected", "Error"];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      output += chunk;
      if (failMarkers.some((m) => chunk.includes(m))) success = false;
    }
    const tail = decoder.decode();
    if (tail) {
      output += tail;
      if (failMarkers.some((m) => tail.includes(m))) success = false;
    }
    return { output, success };
  };

  // ── Individual device reset ──────────────────────────────────────────────────
  const executeDeviceReset = useCallback(
    async (slotId: number) => {
      const patchDevice = (patch: Partial<DeviceResetState>) =>
        setDeviceStates((prev) => ({
          ...prev,
          [slotId]: { ...prev[slotId], ...patch } as DeviceResetState,
        }));

      setDeviceStates((prev) => ({
        ...prev,
        [slotId]: { step: "deleting", error: null, cmdOutput: null, showOutput: false },
      }));

      try {
        // Step 1 — stop only the model(s) on this slot
        const slot =
          chipFetch.status === "success"
            ? chipFetch.data.slots.find((s) => s.slot_id === slotId)
            : undefined;

        if (slot?.status === "occupied") {
          const currentModels = await fetchModels();
          const toStop = currentModels.filter((m) => {
            if (m.device_id !== undefined && m.device_id !== null) {
              return m.device_id === slotId;
            }
            // Multi-chip models have device_id 0 and occupy all slots
            if (slot.is_multi_chip) return true;
            return false;
          });
          for (const model of toStop) {
            await deleteModel(model.id);
          }
          await refreshModels();
        }

        // Step 2 — chip-level reset
        patchDevice({ step: "resetting" });
        const response = await axios.post<Blob>(
          `/docker-api/reset_device/${slotId}/`,
          null,
          { responseType: "blob" }
        );
        const { output, success } = await readStreamOutput(response.data);

        if (!success) throw new Error("Chip reset failed. See command output for details.");

        patchDevice({ step: "done", cmdOutput: output });
        refreshDeviceState();
        fetchChipStatus();
        if (onReset) onReset();
      } catch (err) {
        patchDevice({
          step: "failed",
          error: err instanceof Error ? err.message : "An unknown error occurred.",
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chipFetch, refreshModels, refreshDeviceState, fetchChipStatus, onReset]
  );

  const toggleDeviceOutput = useCallback((slotId: number) => {
    setDeviceStates((prev) => ({
      ...prev,
      [slotId]: { ...prev[slotId], showOutput: !prev[slotId]?.showOutput },
    }));
  }, []);

  // ── Full board reset ─────────────────────────────────────────────────────────
  const executeBoardReset = useCallback(async () => {
    setBoardStep("deleting");
    setBoardError(null);
    setBoardOutput(null);
    setShowBoardOutput(false);

    try {
      const currentModels = await fetchModels();
      for (const model of currentModels) {
        await deleteModel(model.id);
      }
      await refreshModels();

      setBoardStep("resetting");
      const response = await axios.post<Blob>("/docker-api/reset_board/", null, {
        responseType: "blob",
      });
      const { output, success } = await readStreamOutput(response.data);

      setBoardOutput(output);
      if (!success) throw new Error("Board reset failed. See command output for details.");

      setBoardStep("done");
      refreshDeviceState();
      fetchChipStatus();
      if (onReset) onReset();
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : "An unknown error occurred.");
      setBoardStep("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshModels, refreshDeviceState, fetchChipStatus, onReset]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const slots: ChipSlot[] =
    chipFetch.status === "success"
      ? chipFetch.data.slots
      : Array.from({ length: 4 }, (_, i) => ({
          slot_id: i,
          status: "available" as const,
        }));

  const totalSlots = chipFetch.status === "success" ? chipFetch.data.total_slots : slots.length;
  const allDevicesDone =
    Object.keys(deviceStates).length > 0 &&
    Object.values(deviceStates).every((s) => s.step === "done" || s.step === "failed");

  const showDeviceGrid = boardStep === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-7 rounded-xl shadow-2xl bg-stone-900 text-white border border-stone-700 backdrop-blur-md">
        {/* ── HEADER ── */}
        <DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center ${
                  isBoardResetting || isAnyDeviceResetting
                    ? "bg-blue-900/50"
                    : boardStep === "done" || allDevicesDone
                      ? "bg-green-900/50"
                      : boardStep === "failed"
                        ? "bg-red-900/50"
                        : "bg-yellow-900/50"
                }`}
              >
                {isBoardResetting || isAnyDeviceResetting ? (
                  <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                ) : boardStep === "done" || allDevicesDone ? (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                ) : boardStep === "failed" ? (
                  <XCircle className="h-5 w-5 text-red-400" />
                ) : (
                  <RotateCcw className="h-5 w-5 text-yellow-400" />
                )}
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-white leading-tight">
                  {isBoardResetting
                    ? boardStep === "deleting"
                      ? "Removing all deployed models…"
                      : "Resetting all chips…"
                    : boardStep === "done"
                      ? "Full board reset complete"
                      : boardStep === "failed"
                        ? "Full board reset failed"
                        : "Reset Card"}
                </DialogTitle>
                <p className="text-xs text-stone-400 mt-0.5">
                  {totalSlots} chip{totalSlots !== 1 ? "s" : ""} detected — reset individually or all at once
                </p>
              </div>
            </div>
            {boardType !== "unknown" && <BoardBadge boardName={boardType} />}
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* ── Data freshness bar ── */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              {chipFetch.status === "loading" && (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-stone-400" />
                  <span className="text-stone-400">Fetching model status…</span>
                </>
              )}
              {chipFetch.status === "success" && (
                <>
                  <CheckCircle className="w-3 h-3 text-green-400" />
                  <span className="text-stone-400">
                    Verified at {chipFetch.fetchedAt.toLocaleTimeString()}
                  </span>
                </>
              )}
              {chipFetch.status === "error" && (
                <>
                  <AlertTriangle className="w-3 h-3 text-yellow-400" />
                  <span className="text-yellow-400">
                    Model info unavailable — data may be incorrect
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={fetchChipStatus}
              disabled={isAnyResetting}
              className="flex items-center gap-1 text-stone-400 hover:text-stone-200 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          {/* ── Already resetting banner ── */}
          {isResettingContext && (
            <div className="flex items-center gap-3 p-3 bg-blue-900/30 border border-blue-500/40 rounded-lg text-blue-200 text-sm">
              <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />
              <span>Board is already resetting…</span>
            </div>
          )}

          {/* ── Device cards grid ── */}
          {showDeviceGrid && (
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
              {slots.map((slot) => {
                const ds: DeviceResetState = deviceStates[slot.slot_id] ?? {
                  step: "idle",
                  error: null,
                  cmdOutput: null,
                  showOutput: false,
                };
                return (
                  <DeviceCard
                    key={slot.slot_id}
                    slot={slot}
                    deviceState={ds}
                    fetchState={chipFetch}
                    onReset={executeDeviceReset}
                    onToggleOutput={toggleDeviceOutput}
                    isAnyResetting={isAnyResetting || isResettingContext}
                  />
                );
              })}
            </div>
          )}

          {/* ── Full-board reset progress ── */}
          {boardStep !== null && (
            <div className="space-y-2">
              <StepRow
                number={1}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                label="Stop all deployed models"
                sublabel="Sending stop signal to all containers…"
                state={
                  boardStep === "deleting"
                    ? "active"
                    : ["resetting", "done", "failed"].includes(boardStep)
                      ? "done"
                      : "pending"
                }
              />
              <StepRow
                number={2}
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                label="Reset all chips (tt-smi -r)"
                sublabel="Running full board reset, may take 10–30 seconds…"
                state={
                  boardStep === "resetting"
                    ? "active"
                    : boardStep === "done"
                      ? "done"
                      : "pending"
                }
              />

              {boardStep === "failed" && boardError && (
                <div className="flex items-start gap-3 p-3 bg-red-900/30 border border-red-500/40 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium text-red-200">{boardError}</p>
                </div>
              )}

              {(boardStep === "done" || boardStep === "failed") && boardOutput && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBoardOutput((v) => !v)}
                    className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 transition-colors"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showBoardOutput ? "rotate-180" : ""}`}
                    />
                    {showBoardOutput ? "Hide" : "Show"} command output
                  </button>
                  {showBoardOutput && (
                    <ScrollArea className="h-36 rounded-lg border border-stone-700">
                      <pre
                        className={`p-3 text-xs whitespace-pre-wrap font-mono bg-stone-950 ${
                          boardStep === "done" ? "text-green-400" : "text-red-300"
                        }`}
                      >
                        {boardOutput}
                      </pre>
                    </ScrollArea>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Warnings (idle state only) ── */}
          {showDeviceGrid && !isAnyDeviceResetting && !allDevicesDone && (
            <div className="space-y-2">
              {/* Per-chip warning */}
              <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-500/25 rounded-lg text-red-200 text-sm">
                <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <span>
                  <strong className="text-red-300">Warning:</strong> Resetting a chip will
                  interrupt any ongoing processes on that device.
                </span>
              </div>
              {/* Reset All specific warning */}
              <div className="flex items-start gap-2 p-3 bg-orange-950/40 border border-orange-500/25 rounded-lg text-orange-200 text-sm">
                <AlertTriangle className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
                <span>
                  <strong className="text-orange-300">Reset All Chips</strong> will stop{" "}
                  <strong className="text-orange-300">every deployed model</strong> and interrupt{" "}
                  <strong className="text-orange-300">all processes</strong> across all{" "}
                  {totalSlots} chip{totalSlots !== 1 ? "s" : ""} simultaneously.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <DialogFooter className="mt-6 flex justify-between items-center gap-2">
          <div>
            {showDeviceGrid && !isAnyDeviceResetting && !allDevicesDone && (
              <Button
                variant="outline"
                onClick={executeBoardReset}
                disabled={isAnyResetting || isResettingContext}
                className="border-red-700/50 text-red-300 hover:bg-red-900/30 hover:text-red-200 disabled:opacity-40"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset All Chips
              </Button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-stone-600 text-stone-300 hover:bg-stone-800"
          >
            {isAnyResetting ? "Minimize" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MultiCardResetDialog;
