// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useRef } from "react";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Typography } from "@tenstorrent/vesper/typography";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { useModelActionsPaused } from "@/src/vesper/hooks/use-model-actions-paused";
import type { DeploymentItem } from "@/src/vesper/types";
import { formatDeviceLabel } from "@/src/vesper/utils/models";

/** What stopping the solution does to one of its models. */
function memberAction(member: DeploymentItem) {
  if (member.containerId && !member.dead) {
    const devices = member.deviceIds.map((id) => formatDeviceLabel(id));
    return devices.length > 0 ? `Stop · ${devices.join(" + ")}` : "Stop";
  }
  if (
    member.jobId &&
    !member.containerId &&
    (member.state === "downloading" || member.state === "deploying")
  ) {
    return "Cancel deploy";
  }
  return "Clear";
}

/**
 * Confirms stopping every model a solution (e.g. the voice agent) is made of:
 * running ones are stopped, deploys still in progress cancelled, and failed
 * ones cleared.
 */
export function StopSolutionModal({
  item,
  onClose,
  onConfirm,
}: {
  /** The solution's combined item; the modal is open while this is set */
  item: DeploymentItem | null;
  onClose(): void;
  onConfirm(item: DeploymentItem): void;
}) {
  const paused = useModelActionsPaused();

  // keep showing the solution while the modal animates closed
  const itemRef = useRef(item);
  if (item) itemRef.current = item;
  const shown = item ?? itemRef.current;
  const members = shown?.members ?? [];
  // a pause only gets in the way of stopping running containers; deploys that
  // haven't started one can still be cancelled
  const blocked = !!paused && members.some((m) => m.containerId && !m.dead);
  const name = shown?.modelName ?? "this solution";

  return (
    <ControlledModal
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Stop ${name}?`}
      description="Its running models will be stopped and their devices reset, and any deploys still in progress will be cancelled. Anything they're processing will be interrupted."
      width={520}
      buttons={[
        { children: "Cancel", onClick: onClose },
        {
          children: "Stop all",
          variant: "danger",
          disabled: blocked || members.length === 0,
          onClick: () => {
            if (item) onConfirm(item);
            onClose();
          },
        },
      ]}
    >
      <div className="flex flex-col gap-vesper-3 pt-vesper-2">
        {blocked && (
          <Admonition variant="info" size="sm">
            {paused}
          </Admonition>
        )}
        <ul className="flex flex-col gap-vesper-2">
          {members.map((member) => (
            <li
              key={member.key}
              className="flex items-center justify-between gap-vesper-3 rounded-vesper-1 border border-vesper-border-secondary px-vesper-3 py-vesper-2"
            >
              <Typography
                variant="label-sm"
                className="truncate text-vesper-text-primary"
              >
                {member.modelName}
              </Typography>
              <Typography
                variant="label-xs-mono"
                className="shrink-0 text-vesper-text-tertiary"
              >
                {memberAction(member)}
              </Typography>
            </li>
          ))}
        </ul>
      </div>
    </ControlledModal>
  );
}
