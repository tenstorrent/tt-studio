// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Button } from "@tenstorrent/vesper/button";
import {
  CaretDown,
  CaretUp,
  Chip as ChipIcon,
  Link,
  Reset,
} from "@tenstorrent/vesper/icons";
import {
  StatusIndicator,
  type StatusIndicatorState,
} from "@tenstorrent/vesper/status-indicator";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { useIsResetting } from "@/src/hooks/useIsResetting";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { useDeployments } from "@/src/vesper/hooks/use-deployments";
import { chipsForSlot } from "@/src/vesper/hooks/use-hardware";
import { useChipStatus } from "@/src/vesper/hooks/use-chip-status";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import {
  resetTargetKey,
  useHardwareReset,
  type ResetProgress,
  type ResetTarget,
} from "@/src/vesper/hooks/use-hardware-reset";
import { formatDeviceLabel } from "@/src/vesper/utils/models";
import type { DeploymentItem } from "@/src/vesper/types";

interface ResetUnit {
  target: ResetTarget;
  slots: number[];
  label: string;
  boardType: string;
  deployment?: DeploymentItem;
  occupied: boolean;
}

/**
 * The reset units of the board: every deployed model owns all of its slots as
 * one unit (so a multi-device model is never half reset), and every remaining
 * slot is its own unit.
 */
function useResetUnits(): ResetUnit[] {
  const { chipStatus } = useChipStatus();
  const { deviceState } = useDeviceState();
  const { items } = useDeployments();

  return useMemo(() => {
    const totalSlots = chipStatus?.total_slots ?? 0;
    const chips = deviceState?.devices ?? [];
    const prefix = totalSlots < chips.length ? "C" : "D";
    const boardTypeForSlots = (slots: number[]) => {
      const chip = chips.find((c) =>
        chipsForSlot(slots[0], chipStatus, chips.length).includes(c.index)
      );
      return (chip?.board_type ?? deviceState?.board_type ?? "").replace(
        /\s+[LR]$/i,
        ""
      );
    };

    const units: ResetUnit[] = [];
    const consumed = new Set<number>();
    for (let slot = 0; slot < totalSlots; slot++) {
      if (consumed.has(slot)) continue;
      const deployment = items.find(
        (item) =>
          item.containerId &&
          item.state !== "download-failed" &&
          item.state !== "deploy-failed" &&
          item.deviceIds.includes(slot)
      );
      if (deployment?.containerId) {
        const slots = deployment.deviceIds
          .filter((s) => s < totalSlots)
          .sort((a, b) => a - b);
        slots.forEach((s) => consumed.add(s));
        units.push({
          target: {
            kind: "model",
            containerId: deployment.containerId,
            slots,
          },
          slots,
          label: slots.map((s) => formatDeviceLabel(s, prefix)).join(" + "),
          boardType: boardTypeForSlots(slots),
          deployment,
          occupied: true,
        });
      } else {
        units.push({
          target: { kind: "slot", slot },
          slots: [slot],
          label: formatDeviceLabel(slot, prefix),
          boardType: boardTypeForSlots([slot]),
          occupied:
            chipStatus?.slots.find((s) => s.slot_id === slot)?.status ===
            "occupied",
        });
      }
    }
    return units;
  }, [chipStatus, deviceState, items]);
}

function unitStatus(
  unit: ResetUnit,
  progress: ResetProgress
): { state: StatusIndicatorState; label: string; animated?: boolean } {
  switch (progress.step) {
    case "stopping":
      return { state: "progress", label: "Stopping", animated: true };
    case "resetting":
      return { state: "progress", label: "Resetting", animated: true };
    case "done":
      return { state: "ready", label: "Reset" };
    case "failed":
      return { state: "error", label: "Reset failed" };
    default:
      break;
  }
  if (unit.deployment?.state === "error")
    return { state: "error", label: "Failed" };
  if (unit.deployment?.state === "active" || unit.occupied)
    return { state: "ready", label: "Busy" };
  if (unit.deployment) return { state: "progress", label: "Deploying" };
  return { state: "cancelled", label: "Idle" };
}

function ResetOutput({ output, failed }: { output: string; failed?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!output) return null;
  return (
    <div className="flex flex-col gap-vesper-2">
      <TextButton
        type="button"
        size="sm"
        variant="subtle"
        iconRight={open ? <CaretUp /> : <CaretDown />}
        onClick={() => setOpen(!open)}
        className="mr-auto"
      >
        {open ? "Hide output" : "Show output"}
      </TextButton>
      {open && (
        <pre
          className={cn(
            "max-h-40 overflow-auto rounded-vesper-1 p-vesper-3 font-vesper-mono text-xs whitespace-pre-wrap bg-vesper-tint-neutral-200",
            failed ? "text-vesper-text-error" : "text-vesper-text-secondary"
          )}
        >
          {output}
        </pre>
      )}
    </div>
  );
}

function ResetUnitCard({
  unit,
  progress,
  disabled,
  onReset,
}: {
  unit: ResetUnit;
  progress: ResetProgress;
  disabled: boolean;
  onReset(): void;
}) {
  const status = unitStatus(unit, progress);
  const failed = unit.deployment?.state === "error";
  return (
    <div
      className={cn(
        "flex flex-col gap-vesper-4 rounded-vesper-2 border p-vesper-4 bg-vesper-background-primary",
        failed
          ? "border-vesper-border-error-subtle"
          : "border-vesper-border-secondary"
      )}
    >
      <div className="flex items-center gap-vesper-3">
        <Typography
          variant="label-md-bold"
          className="text-vesper-text-primary"
        >
          {unit.label}
        </Typography>
        {unit.boardType && (
          <Typography
            variant="label-xs"
            className="flex items-center gap-vesper-1 text-vesper-text-secondary"
          >
            <ChipIcon className="w-3.5 h-3.5" />
            {unit.boardType}
          </Typography>
        )}
        <StatusIndicator
          className="ml-auto [&_.vesper-status-indicator-label]:font-vesper-mono [&_.vesper-status-indicator-label]:uppercase [&_.vesper-status-indicator-label]:text-xs"
          state={status.state}
          label={status.label}
          animated={status.animated}
        />
      </div>
      <Typography
        variant="label-sm"
        className={cn(
          "flex items-center gap-vesper-2 min-h-4",
          failed ? "text-vesper-text-error" : "text-vesper-text-accent"
        )}
      >
        {unit.deployment && (
          <>
            <Link className="w-4 h-4 shrink-0" />
            <span className="truncate">{unit.deployment.modelName}</span>
          </>
        )}
      </Typography>
      {progress.error && (
        <Typography variant="copy-xs" className="text-vesper-text-error">
          {progress.error}
        </Typography>
      )}
      <ResetOutput
        output={progress.output}
        failed={progress.step === "failed"}
      />
      <Button
        type="button"
        size="xs"
        variant={failed ? "danger" : "tertiary"}
        iconLeft={<Reset />}
        className="mr-auto"
        disabled={disabled}
        onClick={onReset}
      >
        Reset
      </Button>
    </div>
  );
}

/**
 * Resets devices individually or the whole board at once. Every reset is
 * confirmed first, since it interrupts anything running on those devices.
 */
export function ResetHardwareModal({
  open,
  onOpenChange,
  initialSlot,
  onResetFinished,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** When set, the modal opens straight to confirming a reset of this slot */
  initialSlot?: number | null;
  /** Called with the slots that were reset, once a reset succeeds */
  onResetFinished?(slots: number[]): void;
}) {
  const units = useResetUnits();
  const reset = useHardwareReset();
  const boardResetting = useIsResetting();
  const [confirming, setConfirming] = useState<ResetUnit | "all" | null>(null);

  // open straight into the confirmation for a specific device
  useEffect(() => {
    if (!open || initialSlot === null || initialSlot === undefined) return;
    const unit = units.find((u) => u.slots.includes(initialSlot));
    if (unit) setConfirming(unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSlot]);

  const boardStep = reset.board.step;
  const showBoardProgress = boardStep !== "idle";
  const busy = reset.isRunning || boardResetting;

  const confirmTitle =
    confirming === "all"
      ? "Are you sure you want to reset every card?"
      : "Are you sure you want to reset this processor?";
  const confirmDescription =
    confirming === "all"
      ? "This action cannot be undone. Every deployed model will be stopped, and all devices will be reset."
      : "This action cannot be undone. Resetting will interrupt any ongoing processes on this device.";

  return (
    <>
      <ControlledModal
        open={open && confirming === null}
        onOpenChange={(next) => {
          if (!next && confirming === null) {
            onOpenChange(false);
            if (!reset.isRunning) reset.clear();
          }
        }}
        title="Reset cards"
        description="Reset individually or all at once"
        width={640}
        maxHeight={760}
        buttons={
          showBoardProgress
            ? [
                {
                  children: reset.isRunning ? "Minimize" : "Done",
                  variant: "tertiary",
                  onClick: () => {
                    onOpenChange(false);
                    if (!reset.isRunning) reset.clear();
                  },
                },
              ]
            : [
                {
                  children: "Cancel",
                  onClick: () => onOpenChange(false),
                },
                {
                  children: "Reset all cards",
                  variant: "danger",
                  disabled: busy || units.length === 0,
                  onClick: () => setConfirming("all"),
                },
              ]
        }
      >
        <div className="flex flex-col gap-vesper-4 pt-vesper-2">
          {boardResetting && !reset.isRunning && (
            <Admonition variant="info" size="sm">
              A board reset is in progress. Actions are paused until it
              finishes, which takes about a minute or two.
            </Admonition>
          )}
          {!showBoardProgress && (
            <>
              <Admonition variant="danger" size="sm" subtle>
                Warning: Resetting a chip will interrupt any ongoing processes
                on that device.
              </Admonition>
              {units.length === 0 ? (
                <Typography
                  variant="copy-sm"
                  className="text-vesper-text-secondary"
                >
                  No devices detected.
                </Typography>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-vesper-4">
                  {units.map((unit) => (
                    <ResetUnitCard
                      key={resetTargetKey(unit.target)}
                      unit={unit}
                      progress={reset.getProgress(unit.target)}
                      disabled={busy}
                      onReset={() => setConfirming(unit)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          {showBoardProgress && (
            <div className="flex flex-col gap-vesper-4">
              <BoardResetStep
                label="Stop all deployed models"
                state={
                  boardStep === "stopping"
                    ? "active"
                    : boardStep === "failed" && !reset.board.output
                      ? "failed"
                      : "done"
                }
              />
              <BoardResetStep
                label="Reset all devices"
                state={
                  boardStep === "resetting"
                    ? "active"
                    : boardStep === "done"
                      ? "done"
                      : boardStep === "failed"
                        ? "failed"
                        : "pending"
                }
              />
              {reset.board.error && (
                <Admonition variant="danger" size="sm">
                  {reset.board.error}
                </Admonition>
              )}
              {reset.board.output && (
                <pre className="max-h-48 overflow-auto rounded-vesper-1 p-vesper-3 font-vesper-mono text-xs whitespace-pre-wrap bg-vesper-tint-neutral-200 text-vesper-text-secondary">
                  {reset.board.output}
                </pre>
              )}
            </div>
          )}
        </div>
      </ControlledModal>
      <ControlledModal
        open={open && confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={confirmTitle}
        description={confirmDescription}
        width={500}
        buttonsAlignment="fill"
        buttons={[
          { children: "Nevermind", onClick: () => setConfirming(null) },
          {
            children: "Reset",
            variant: "danger",
            onClick: () => {
              const target = confirming;
              setConfirming(null);
              if (target === "all") {
                void reset.resetBoard().then((ok) => {
                  if (ok) onResetFinished?.(units.flatMap((u) => u.slots));
                });
              } else if (target) {
                void reset.resetTarget(target.target).then((ok) => {
                  if (ok) onResetFinished?.(target.slots);
                });
              }
            },
          },
        ]}
      />
    </>
  );
}

function BoardResetStep({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done" | "failed";
}) {
  const indicator: Record<typeof state, StatusIndicatorState> = {
    pending: "cancelled",
    active: "progress",
    done: "ready",
    failed: "error",
  };
  const text: Record<typeof state, string> = {
    pending: "Pending",
    active: "In progress",
    done: "Done",
    failed: "Failed",
  };
  return (
    <div className="flex items-center justify-between gap-vesper-4 rounded-vesper-2 border border-vesper-border-secondary px-vesper-4 py-vesper-3">
      <Typography variant="label-md" className="text-vesper-text-primary">
        {label}
      </Typography>
      <StatusIndicator
        state={indicator[state]}
        label={text[state]}
        animated={state === "active"}
      />
    </div>
  );
}
