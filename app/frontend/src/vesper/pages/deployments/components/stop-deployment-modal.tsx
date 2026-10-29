// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Admonition } from "@tenstorrent/vesper/admonition";
import {
  StatusIndicator,
  type StatusIndicatorState,
} from "@tenstorrent/vesper/status-indicator";
import { Typography } from "@tenstorrent/vesper/typography";
import { useDeleteStream } from "@/src/hooks/useDeleteStream";
import { useModels } from "@/src/hooks/useModels";
import { useRefresh } from "@/src/hooks/useRefresh";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import { resetDeviceIdsForStop } from "@/src/utils/deviceIds";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { DeviceTag } from "@/src/vesper/components/device-tag";
import {
  CHIP_STATUS_QUERY_KEY,
  useChipStatus,
} from "@/src/vesper/hooks/use-chip-status";
import { useModelActionsPaused } from "@/src/vesper/hooks/use-model-actions-paused";
import type { DeploymentItem } from "@/src/vesper/types";
import { formatDeviceLabel } from "@/src/vesper/utils/models";

function Step({
  label,
  state,
  logs,
}: {
  label: string;
  state: "pending" | "active" | "done" | "failed";
  logs: string[];
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
    <div className="flex flex-col gap-vesper-3 rounded-vesper-2 border border-vesper-border-secondary p-vesper-4">
      <div className="flex items-center justify-between gap-vesper-4">
        <Typography variant="label-md" className="text-vesper-text-primary">
          {label}
        </Typography>
        <StatusIndicator
          state={indicator[state]}
          label={text[state]}
          animated={state === "active"}
        />
      </div>
      {logs.length > 0 && (
        <pre className="max-h-32 overflow-auto rounded-vesper-1 p-vesper-3 font-vesper-mono text-xs whitespace-pre-wrap bg-vesper-tint-neutral-200 text-vesper-text-secondary">
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
}

/**
 * Confirms and then streams the stop of a deployment's container, which also
 * resets the devices it ran on.
 */
export function StopDeploymentModal({
  item,
  onClose,
  onStopped,
}: {
  /** The deployment to stop; the modal is open while this is set */
  item: DeploymentItem | null;
  onClose(): void;
  onStopped?(item: DeploymentItem): void;
}) {
  const queryClient = useQueryClient();
  const deleteStream = useDeleteStream();
  const { refreshModels, setUserStoppedModel, setIsDeleteInFlight } =
    useModels();
  const { triggerHardwareRefresh } = useRefresh();
  const { refresh: refreshDeviceState } = useDeviceState();
  const paused = useModelActionsPaused();
  const running = deleteStream.status === "running";
  const finished =
    deleteStream.status === "success" ||
    deleteStream.status === "partial" ||
    deleteStream.status === "error";

  const itemRef = useRef(item);
  if (item) itemRef.current = item;

  useEffect(() => {
    setIsDeleteInFlight(running);
  }, [running, setIsDeleteInFlight]);
  // the stream closes with this modal (e.g. on leaving the page), and the UI
  // loses track of the stop; don't leave resets blocked behind it
  useEffect(() => () => setIsDeleteInFlight(false), [setIsDeleteInFlight]);

  // close shortly after a successful stop
  useEffect(() => {
    if (deleteStream.status !== "success") return;
    setUserStoppedModel(true);
    const timer = setTimeout(() => {
      if (itemRef.current) onStopped?.(itemRef.current);
      onClose();
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteStream.status]);

  // the stream reached its reset step: other views should know about it
  useEffect(() => {
    if (deleteStream.step === "resetting") refreshDeviceState();
  }, [deleteStream.step, refreshDeviceState]);

  const handleClose = () => {
    if (finished) {
      refreshModels();
      void triggerHardwareRefresh();
      queryClient.invalidateQueries({ queryKey: CHIP_STATUS_QUERY_KEY });
    }
    if (!running) deleteStream.reset();
    onClose();
  };

  const stepState = (step: "deleting" | "resetting") => {
    if (deleteStream.status === "idle") return "pending";
    if (deleteStream.status === "error" && deleteStream.step === step)
      return "failed";
    if (deleteStream.step === step && running) return "active";
    if (step === "deleting") return "done";
    return deleteStream.status === "success" ? "done" : "pending";
  };

  const name = item?.modelName ?? itemRef.current?.modelName ?? "this model";

  // The devices the stop resets: the model's own, plus the rest of its card
  // when nothing else is on it (the backend resets an idle card as a whole).
  // A preview until the backend says which devices it is resetting.
  const { chipStatus, refetch: refetchChipStatus } = useChipStatus();
  useEffect(() => {
    // chip status can be a while old; preview against current occupancy
    if (item) void refetchChipStatus();
  }, [item, refetchChipStatus]);
  const ownDevices = (item ?? itemRef.current)?.deviceIds ?? [];
  const devicesToReset =
    deleteStream.resetDeviceIds ??
    resetDeviceIdsForStop(ownDevices, chipStatus) ??
    ownDevices;
  const cardSiblings = devicesToReset.filter((id) => !ownDevices.includes(id));

  return (
    <ControlledModal
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      title={
        deleteStream.status === "idle" ? "Stop container?" : `Stopping ${name}`
      }
      description={
        deleteStream.status === "idle"
          ? `${name} will be stopped and the devices it runs on will be reset. Anything it's processing will be interrupted.`
          : "Stopping the container, then resetting its devices. This can take up to a minute."
      }
      width={520}
      buttons={
        deleteStream.status === "idle"
          ? [
              { children: "Cancel", onClick: handleClose },
              {
                children: "Stop container",
                variant: "danger",
                disabled: !!paused,
                onClick: () => {
                  if (item?.containerId) deleteStream.start(item.containerId);
                },
              },
            ]
          : [
              {
                children: running ? "Minimize" : "Close",
                variant: "tertiary",
                onClick: handleClose,
              },
            ]
      }
    >
      <div className="flex flex-col gap-vesper-3 pt-vesper-2">
        {deleteStream.status === "idle" && paused && (
          <Admonition variant="info" size="sm">
            {paused}
          </Admonition>
        )}
        {devicesToReset.length > 0 && deleteStream.status !== "success" && (
          <div className="flex flex-col gap-vesper-2">
            <Typography
              variant="label-sm"
              className="text-vesper-text-secondary"
            >
              {deleteStream.status === "idle"
                ? "Devices that will be reset"
                : "Devices being reset"}
            </Typography>
            <div className="flex flex-wrap gap-vesper-2">
              {devicesToReset.map((id) => (
                <DeviceTag key={id} deviceId={id} />
              ))}
            </div>
            {cardSiblings.length > 0 && (
              <Typography
                variant="copy-xs"
                className="text-vesper-text-tertiary"
              >
                {cardSiblings.map((id) => formatDeviceLabel(id)).join(" and ")}{" "}
                {cardSiblings.length === 1 ? "is" : "are"} on the same card and
                idle, so the whole card is reset together.
              </Typography>
            )}
          </div>
        )}
        {deleteStream.status !== "idle" && (
          <>
            <Step
              label="Stop container"
              state={stepState("deleting")}
              logs={deleteStream.stepLogs.deleting}
            />
            <Step
              label="Reset devices"
              state={stepState("resetting")}
              logs={deleteStream.stepLogs.resetting}
            />
            {deleteStream.errorMessage && (
              <Admonition
                variant={
                  deleteStream.status === "partial" ? "warning" : "danger"
                }
                size="sm"
              >
                {deleteStream.errorMessage}
              </Admonition>
            )}
          </>
        )}
      </div>
    </ControlledModal>
  );
}
