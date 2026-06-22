// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useCallback, useEffect } from "react";
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
import { fetchModels, streamResetAction, startResetAll, getResetAllStatus } from "../api/modelsDeployedApis";
import { useModels } from "../hooks/useModels";
import { useDeviceState } from "../hooks/useDeviceState";
import { useRefresh } from "../hooks/useRefresh";
import type { Model } from "../contexts/ModelsContext";
import BoardBadge from "./BoardBadge";
import StreamingLogPanel from "./StreamingLogPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type UnitStep = "idle" | "deleting" | "resetting" | "done" | "failed";

interface UnitResetState {
  step: UnitStep;
  error: string | null;
  cmdOutput: string | null;
  showOutput: boolean;
}

// A reset target: a deployed model (resets every chip it occupies as one action,
// so a multi-chip model is never half-reset) or a single free chip.
type ResetUnit =
  | { kind: "model"; id: string; model: Model; slots: number[] }
  | { kind: "empty"; id: string; slot: number };

interface ChipStatusData {
  total_slots: number;
}

type ChipStatusFetchState =
  | { status: "loading" }
  | { status: "success"; data: ChipStatusData; fetchedAt: Date }
  | { status: "error"; message: string };

interface MultiCardResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReset?: () => void;
}

const IDLE_STATE: UnitResetState = { step: "idle", error: null, cmdOutput: null, showOutput: false };

// ── Slot grouping ───────────────────────────────────────────────────────────────

function modelSlots(m: Model): number[] {
  const ids =
    m.device_ids && m.device_ids.length > 0
      ? m.device_ids
      : m.device_id != null
        ? [m.device_id]
        : [];
  return [...new Set(ids)].sort((a, b) => a - b);
}

// Group the board's chips into reset units: each deployed model owns all its
// chips as one unit; every remaining chip is its own unit. Units are keyed by
// their first slot so a unit's progress survives a model refresh.
function buildUnits(models: Model[], totalSlots: number): ResetUnit[] {
  const owner = new Map<number, Model>();
  for (const m of models) {
    for (const slot of modelSlots(m)) {
      if (slot < totalSlots) owner.set(slot, m);
    }
  }

  const units: ResetUnit[] = [];
  const consumed = new Set<number>();
  for (let slot = 0; slot < totalSlots; slot++) {
    if (consumed.has(slot)) continue;
    const m = owner.get(slot);
    if (!m) {
      units.push({ kind: "empty", id: `slot-${slot}`, slot });
      continue;
    }
    const slots = modelSlots(m).filter((s) => s < totalSlots);
    slots.forEach((s) => consumed.add(s));
    units.push({ kind: "model", id: `slot-${slots[0]}`, model: m, slots });
  }
  return units;
}

function formatSlots(slots: number[]): string {
  if (slots.length === 1) return `${slots[0]}`;
  const contiguous = slots.every((s, i) => i === 0 || s === slots[i - 1] + 1);
  return contiguous ? `${slots[0]}–${slots[slots.length - 1]}` : slots.join(", ");
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
      className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${state === "active"
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
          className={`font-medium text-sm inline-flex items-center gap-1.5 ${state === "pending" || state === "skipped" ? "text-stone-400" : "text-white"
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
      </div>
    </div>
  );
}

// ── Reset unit card ─────────────────────────────────────────────────────────────
function UnitCard({
  unit,
  state,
  onReset,
  onToggleOutput,
  disabled,
}: {
  unit: ResetUnit;
  state: UnitResetState;
  onReset: (unit: ResetUnit) => void;
  onToggleOutput: (unitId: string) => void;
  disabled: boolean;
}) {
  const { step, error, cmdOutput, showOutput } = state;
  const isModel = unit.kind === "model";
  const isActive = step === "deleting" || step === "resetting";
  const isDone = step === "done";
  const isFailed = step === "failed";
  const isIdle = step === "idle";

  const slots = isModel ? unit.slots : [unit.slot];
  const slotLabel = formatSlots(slots);
  const resetArgs = slots.join(" ");

  const stopState: "pending" | "active" | "done" | "skipped" =
    step === "deleting" ? "active" : isActive || isDone || isFailed ? "done" : "pending";
  const resetState: "pending" | "active" | "done" | "skipped" =
    step === "resetting" ? "active" : isDone ? "done" : "pending";

  const borderCls = isActive
    ? "border-blue-500/40"
    : isDone
      ? "border-green-600/30"
      : isFailed
        ? "border-red-500/40"
        : isModel
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
        ? step === "deleting" ? "Stopping model…" : "Resetting…"
        : isModel
          ? "Model running"
          : "Available";

  const statusColor = isDone
    ? "text-green-400"
    : isFailed
      ? "text-red-400"
      : isActive
        ? "text-blue-400"
        : isModel
          ? "text-amber-400"
          : "text-stone-500";

  return (
    <div
      style={slots.length > 1 ? { gridColumn: `span ${Math.min(slots.length, 4)}` } : undefined}
      className={`flex flex-col rounded-xl border p-5 transition-all duration-300 ${bgCls} ${borderCls}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${isActive
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
            <div className="text-sm font-semibold text-white">
              {slots.length > 1 ? `Devices ${slotLabel}` : `Device ${slotLabel}`}
            </div>
            <div className={`text-xs ${statusColor}`}>{statusLabel}</div>
          </div>
        </div>

        {isIdle && (
          <Button
            size="sm"
            onClick={() => onReset(unit)}
            disabled={disabled}
            className="text-xs h-7 px-2.5 bg-red-700/80 hover:bg-red-600 border border-red-500/30 text-white disabled:opacity-40"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Idle info */}
      {isIdle && isModel && (
        <div className="mt-1.5 space-y-0.5">
          <div className="text-xs text-stone-500">Will stop:</div>
          <div className="flex items-start gap-1.5 text-xs text-amber-300">
            <Trash2 className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="font-medium break-words min-w-0">
              {unit.model.name}
              {slots.length > 1 && (
                <span className="text-stone-400 font-normal"> · all {slots.length} devices</span>
              )}
            </span>
          </div>
        </div>
      )}
      {isIdle && !isModel && (
        <div className="flex items-center gap-1.5 text-xs text-stone-500 mt-1.5">
          <CheckCircle className="w-3 h-3 shrink-0" />
          <span>No model deployed</span>
        </div>
      )}

      {/* Progress steps — during/after reset */}
      {(isActive || isDone || isFailed) && (
        <div className="space-y-2.5 mt-3">
          {isModel && (
            <StepRow
              number={1}
              icon={<Trash2 className="w-3 h-3" />}
              label={`Stop ${unit.model.name}`}
              sublabel="Sending stop signal…"
              state={stopState}
            />
          )}
          <StepRow
            number={isModel ? 2 : 1}
            icon={<RotateCcw className="w-3 h-3" />}
            label={`Reset device${slots.length > 1 ? "s" : ""} (tt-smi -r ${resetArgs})`}
            sublabel="Running device reset, may take 10–30s…"
            state={resetState}
          />
          {isActive && cmdOutput && <StreamingLogPanel output={cmdOutput} />}
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
            onClick={() => onToggleOutput(unit.id)}
            className="mt-2 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showOutput ? "rotate-180" : ""}`} />
            {showOutput ? "Hide" : "Show"} output
          </button>
          {showOutput && (
            <ScrollArea className="mt-1 h-24 rounded border border-stone-700">
              <pre
                className={`p-2 text-xs whitespace-pre-wrap font-mono bg-stone-950 ${isDone ? "text-green-400" : "text-red-300"
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
  const { triggerResetAll } = useRefresh();

  const boardType = deviceState?.board_type ?? "unknown";
  const deviceStateName = deviceState?.state ?? "UNKNOWN";

  const [unitStates, setUnitStates] = useState<Record<string, UnitResetState>>({});
  const [boardStep, setBoardStep] = useState<
    "idle" | "deleting" | "resetting" | "done" | "failed" | null
  >(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardOutput, setBoardOutput] = useState<string | null>(null);
  const [showBoardOutput, setShowBoardOutput] = useState(false);
  const [chipFetch, setChipFetch] = useState<ChipStatusFetchState>({ status: "loading" });
  const [units, setUnits] = useState<ResetUnit[]>([]);

  // Snapshot the chips and their owning models. Taken only on open and manual
  // refresh, so an in-flight reset's card never regroups when its model is removed.
  const loadGrid = useCallback(async () => {
    setChipFetch({ status: "loading" });
    try {
      const res = await fetch("/docker-api/chip-status/");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ChipStatusData = await res.json();
      const models = await fetchModels();
      setChipFetch({ status: "success", data, fetchedAt: new Date() });
      setUnits(buildUnits(models, data.total_slots));
    } catch (err) {
      setChipFetch({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to fetch chip status",
      });
    }
  }, []);

  const isAnyUnitResetting = Object.values(unitStates).some(
    (s) => s.step === "deleting" || s.step === "resetting"
  );
  const isBoardResetting = boardStep === "deleting" || boardStep === "resetting";
  const isAnyResetting = isAnyUnitResetting || isBoardResetting;
  const isResettingContext = deviceStateName === "RESETTING";

  // Re-fetch chips/models and clear local state when the dialog opens (unless a reset is mid-flight).
  useEffect(() => {
    if (!open) return;
    if (!isAnyResetting) {
      setUnitStates({});
      setBoardStep(null);
      setBoardError(null);
      setBoardOutput(null);
      setShowBoardOutput(false);
    }
    loadGrid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Per-unit reset: stop+reset a whole model, or reset a single free chip ──────
  const resetUnit = useCallback(
    async (unit: ResetUnit) => {
      const patch = (p: Partial<UnitResetState>) =>
        setUnitStates((prev) => ({
          ...prev,
          [unit.id]: { ...(prev[unit.id] ?? IDLE_STATE), ...p },
        }));

      patch({
        step: unit.kind === "model" ? "deleting" : "resetting",
        error: null,
        cmdOutput: null,
        showOutput: false,
      });

      try {
        // A model's stop stream stops the container then resets all its chips at
        // once; a free chip just runs tt-smi -r on itself.
        const url =
          unit.kind === "model"
            ? `/docker-api/stop/stream/${unit.model.id}/`
            : `/docker-api/reset_device/stream/${unit.slot}/`;

        let output = "";
        const { status } = await streamResetAction(
          url,
          (line) => {
            output += `${line}\n`;
            patch({ cmdOutput: output });
          },
          (step) => {
            if (step === "deleting" || step === "resetting") patch({ step });
          },
        );

        if (status !== "success") throw new Error("Reset failed. See output for details.");

        patch({ step: "done", cmdOutput: output });
        refreshModels();
        refreshDeviceState();
        if (onReset) onReset();
      } catch (err) {
        patch({
          step: "failed",
          error: err instanceof Error ? err.message : "An unknown error occurred.",
        });
      }
    },
    [refreshModels, refreshDeviceState, onReset]
  );

  const toggleUnitOutput = useCallback((unitId: string) => {
    setUnitStates((prev) => ({
      ...prev,
      [unitId]: { ...(prev[unitId] ?? IDLE_STATE), showOutput: !prev[unitId]?.showOutput },
    }));
  }, []);

  // ── Full board reset ─────────────────────────────────────────────────────────
  const executeBoardReset = useCallback(async () => {
    setBoardStep("deleting");
    setBoardError(null);
    setBoardOutput(null);
    setShowBoardOutput(false);

    try {
      // Drive the whole-board reset as a backend job and poll its status. No
      // EventSource is involved, so "Connection to stream lost." cannot occur;
      // the backend stops every model (verified gone) before resetting the board.
      await startResetAll();
      // Flip the global RESETTING lock immediately for this session instead of
      // waiting for the next device-state poll (other sessions catch up on their poll).
      refreshDeviceState();
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const status = await getResetAllStatus();
        if (status.step === "deleting" || status.step === "resetting") {
          setBoardStep(status.step);
        }
        if (status.logs.length) setBoardOutput(status.logs.join("\n"));
        if (status.done) {
          if (!status.ok) {
            throw new Error(status.error || "Board reset failed. See output for details.");
          }
          break;
        }
      }
      await refreshModels();
      setBoardStep("done");

      refreshDeviceState();
      // The whole board was reset — let views drop stale "Died Unexpectedly" rows.
      triggerResetAll();
      if (onReset) onReset();
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : "An unknown error occurred.");
      setBoardStep("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshModels, refreshDeviceState, onReset, triggerResetAll]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const totalSlots = chipFetch.status === "success" ? chipFetch.data.total_slots : 4;
  const allUnitsDone =
    Object.keys(unitStates).length > 0 &&
    Object.values(unitStates).every((s) => s.step === "done" || s.step === "failed");

  const showDeviceGrid = boardStep === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-7 rounded-xl shadow-2xl bg-stone-900 text-white border border-stone-700 backdrop-blur-md">
        {/* ── HEADER ── */}
        <DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center ${isBoardResetting || isAnyUnitResetting
                  ? "bg-blue-900/50"
                  : boardStep === "done" || allUnitsDone
                    ? "bg-green-900/50"
                    : boardStep === "failed"
                      ? "bg-red-900/50"
                      : "bg-yellow-900/50"
                  }`}
              >
                {isBoardResetting || isAnyUnitResetting ? (
                  <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                ) : boardStep === "done" || allUnitsDone ? (
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
                      : "Resetting all devices…"
                    : boardStep === "done"
                      ? "Full board reset complete"
                      : boardStep === "failed"
                        ? "Full board reset failed"
                        : "Reset Card"}
                </DialogTitle>
                <p className="text-xs text-stone-400 mt-0.5">
                  {totalSlots} device{totalSlots !== 1 ? "s" : ""} detected — reset individually or all at once
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
              onClick={loadGrid}
              disabled={isAnyResetting}
              className="flex items-center gap-1 text-stone-400 hover:text-stone-200 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          {/* ── Already resetting banner -─ Only when the board is being reset *elsewhere* (another tab/user).*/}
          {isResettingContext && !isAnyResetting && boardStep === null && (
            <div className="flex items-start gap-3 p-3 bg-blue-900/30 border border-blue-500/40 rounded-lg text-blue-200 text-sm">
              <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-blue-100">Board reset in progress</p>
                <p className="text-blue-200/90">
                  Stopping all models and re-initializing the board — about a minute or
                  two. Actions are paused; you can close this dialog and the reset will
                  finish in the background.
                </p>
              </div>
            </div>
          )}

          {/* ── Device cards grid ── */}
          {showDeviceGrid && (
            <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
              {units.map((unit) => (
                <UnitCard
                  key={unit.id}
                  unit={unit}
                  state={unitStates[unit.id] ?? IDLE_STATE}
                  onReset={resetUnit}
                  onToggleOutput={toggleUnitOutput}
                  disabled={isAnyResetting || isResettingContext || chipFetch.status === "loading"}
                />
              ))}
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
                label="Reset all devices (tt-smi -r)"
                sublabel="Running full board reset, may take 10–30 seconds…"
                state={
                  boardStep === "resetting"
                    ? "active"
                    : boardStep === "done"
                      ? "done"
                      : "pending"
                }
              />

              {boardStep === "resetting" && boardOutput && (
                <StreamingLogPanel output={boardOutput} />
              )}

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
                        className={`p-3 text-xs whitespace-pre-wrap font-mono bg-stone-950 ${boardStep === "done" ? "text-green-400" : "text-red-300"
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
          {showDeviceGrid && !isAnyUnitResetting && !allUnitsDone && (
            <div className="space-y-2">
              {/* Per-unit warning */}
              <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-500/25 rounded-lg text-red-200 text-sm">
                <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <span>
                  <strong className="text-red-300">Warning:</strong> Resetting interrupts any
                  ongoing processes on the affected devices. Multi-device models are stopped and reset
                  as a whole.
                </span>
              </div>
              {/* Reset All specific warning */}
              <div className="flex items-start gap-2 p-3 bg-orange-950/40 border border-orange-500/25 rounded-lg text-orange-200 text-sm">
                <AlertTriangle className="h-4 w-4 text-orange-400 mt-0.5 shrink-0" />
                <span>
                  <strong className="text-orange-300">Reset All Devices</strong> will stop{" "}
                  <strong className="text-orange-300">every deployed model</strong> and interrupt{" "}
                  <strong className="text-orange-300">all processes</strong> across all{" "}
                  {totalSlots} device{totalSlots !== 1 ? "s" : ""} simultaneously.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <DialogFooter className="mt-6 flex justify-between items-center gap-2">
          <div>
            {showDeviceGrid && !isAnyUnitResetting && !allUnitsDone && (
              <Button
                variant="outline"
                onClick={executeBoardReset}
                disabled={isAnyResetting || isResettingContext}
                className="border-red-700/50 text-red-300 hover:bg-red-900/30 hover:text-red-200 disabled:opacity-40"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset All Devices
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
