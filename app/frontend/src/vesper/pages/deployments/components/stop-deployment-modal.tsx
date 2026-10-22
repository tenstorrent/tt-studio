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
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { CHIP_STATUS_QUERY_KEY } from "@/src/vesper/hooks/use-chip-status";
import type { DeploymentItem } from "@/src/vesper/types";

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
      {deleteStream.status !== "idle" && (
        <div className="flex flex-col gap-vesper-3 pt-vesper-2">
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
              variant={deleteStream.status === "partial" ? "warning" : "danger"}
              size="sm"
            >
              {deleteStream.errorMessage}
            </Admonition>
          )}
        </div>
      )}
    </ControlledModal>
  );
}
