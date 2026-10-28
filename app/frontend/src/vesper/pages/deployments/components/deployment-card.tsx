// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button } from "@tenstorrent/vesper/button";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Ellipses, Reset } from "@tenstorrent/vesper/icons";
import { Menu, type MenuItemProps } from "@tenstorrent/vesper/menu";
import { ProgressBar } from "@tenstorrent/vesper/progress-bar";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { MatrixLoader } from "@/src/vesper/components/matrix-loader";
import type { DeploymentItem, DeploymentState } from "@/src/vesper/types";
import { STATE_LABEL } from "../constants";
import { formatDeviceNumber } from "@/src/vesper/utils/models";

const BORDER: Record<DeploymentState, { idle: string; selected: string }> = {
  downloading: {
    idle: "border-vesper-border-accent-subtle",
    selected: "border-vesper-border-accent-base",
  },
  deploying: {
    idle: "border-vesper-border-warning-subtle",
    selected: "border-vesper-border-warning-base",
  },
  active: {
    idle: "border-vesper-border-tertiary",
    selected: "border-vesper-border-primary",
  },
  "download-failed": {
    idle: "border-vesper-border-error-subtle",
    selected: "border-vesper-border-error-base",
  },
  "deploy-failed": {
    idle: "border-vesper-border-error-subtle",
    selected: "border-vesper-border-error-base",
  },
  error: {
    idle: "border-vesper-border-error-subtle",
    selected: "border-vesper-border-error-base",
  },
};

const MONO_STATUS =
  "[&_.vesper-status-indicator-label]:font-vesper-mono [&_.vesper-status-indicator-label]:text-xs [&_.vesper-status-indicator-label]:text-vesper-text-secondary";

/** The deployment's status line: a loader while in flight, else a status dot. */
export function DeploymentStatus({ state }: { state: DeploymentState }) {
  if (state === "downloading" || state === "deploying") {
    return (
      <Typography
        as="span"
        variant="label-xs-mono"
        className="flex items-center gap-vesper-2 text-vesper-text-secondary"
      >
        <MatrixLoader tone={state === "downloading" ? "accent" : "warning"} />
        {STATE_LABEL[state]}
      </Typography>
    );
  }
  return (
    <StatusIndicator
      className={MONO_STATUS}
      state={state === "active" ? "ready" : "error"}
      label={STATE_LABEL[state]}
    />
  );
}

export function DeviceNumbers({
  deviceIds,
  pending = false,
}: {
  deviceIds: number[];
  /** A deploy that hasn't been placed yet, so its devices are still to be picked */
  pending?: boolean;
}) {
  return (
    <Typography
      as="div"
      variant="label-xs-mono"
      className="flex items-center gap-vesper-2 text-vesper-text-tertiary"
    >
      Devices:
      {deviceIds.length === 0 ? (
        <span>{pending ? "Auto" : "Unknown"}</span>
      ) : (
        deviceIds.map((id) => (
          <span
            key={id}
            className="px-vesper-half py-vesper-half rounded-vesper-half bg-vesper-tint-contrast-100 text-vesper-text-secondary"
          >
            {formatDeviceNumber(id)}
          </span>
        ))
      )}
    </Typography>
  );
}

export function DeploymentCard({
  item,
  selected,
  menuItems,
  onSelect,
  onCancel,
  onRetry,
  onDismiss,
  onRemoveAndRedeploy,
}: {
  item: DeploymentItem;
  selected: boolean;
  menuItems: MenuItemProps[];
  onSelect(): void;
  onCancel(): void;
  onRetry(): void;
  onDismiss(): void;
  onRemoveAndRedeploy(): void;
}) {
  const inFlight = item.state === "downloading" || item.state === "deploying";
  const failed =
    item.state === "download-failed" || item.state === "deploy-failed";

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-vesper-2 border bg-vesper-background-secondary transition-colors duration-vesper-fast",
        "hover:bg-vesper-state-neutral-hover",
        selected
          ? cn(BORDER[item.state].selected, "bg-vesper-tint-neutral-200")
          : BORDER[item.state].idle
      )}
    >
      <div className="flex flex-col gap-vesper-3 px-vesper-3 pt-vesper-3">
        <div className="flex items-center justify-between gap-vesper-3 min-h-6">
          <DeploymentStatus state={item.state} />
          {inFlight && (
            <TextButton
              type="button"
              size="sm"
              variant="subtle"
              className="relative z-10 font-vesper-mono uppercase"
              onClick={onCancel}
            >
              Cancel
            </TextButton>
          )}
          {!inFlight && !failed && menuItems.length > 0 && (
            <Menu
              as={IconButton}
              size="xs"
              variant="ghost"
              icon={<Ellipses />}
              aria-label={`Actions for ${item.modelName}`}
              align="end"
              items={menuItems}
              className="relative z-10"
            />
          )}
        </div>
        {(inFlight || failed) && (
          <div className="flex flex-col gap-vesper-3">
            <ProgressBar
              size="sm"
              value={failed ? 0 : (item.progress ?? 0)}
              aria-label={`${item.modelName} progress`}
            />
            <Typography
              variant="label-xs-mono"
              className={
                failed
                  ? "text-vesper-text-disabled"
                  : "text-vesper-text-primary"
              }
            >
              {failed
                ? "0%"
                : item.progress === null
                  ? "…"
                  : `${item.progress}%`}
            </Typography>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className="cursor-pointer text-left px-vesper-3 py-vesper-6 after:absolute after:inset-0 after:rounded-vesper-2 focus-visible:outline-none focus-visible:after:shadow-vesper-focus-ring"
      >
        <Typography
          as="span"
          variant="label-md"
          className="text-vesper-text-primary break-all"
        >
          {item.modelName}
        </Typography>
      </button>
      <div className="px-vesper-3 py-vesper-3 border-t border-vesper-border-tertiary">
        <DeviceNumbers deviceIds={item.deviceIds} pending={!item.containerId} />
      </div>
      {failed && (
        <div className="relative z-10 grid grid-cols-2 gap-vesper-2 px-vesper-3 py-vesper-3 border-t border-vesper-border-tertiary">
          <Button
            type="button"
            size="xs"
            variant="contrast"
            className="w-full"
            onClick={onRetry}
          >
            {item.state === "download-failed" ? "Retry" : "Redeploy"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="w-full"
            onClick={onDismiss}
          >
            Cancel
          </Button>
        </div>
      )}
      {item.state === "error" && (
        <div className="relative z-10 px-vesper-3 py-vesper-3 border-t border-vesper-border-tertiary">
          <Button
            type="button"
            size="xs"
            variant="danger"
            className="w-full"
            iconLeft={<Reset />}
            onClick={onRemoveAndRedeploy}
          >
            Remove and redeploy
          </Button>
        </div>
      )}
    </div>
  );
}
