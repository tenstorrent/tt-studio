// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useNavigate } from "react-router-dom";
import { Button } from "@tenstorrent/vesper/button";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Ellipses, Link } from "@tenstorrent/vesper/icons";
import { Menu, type MenuItemProps } from "@tenstorrent/vesper/menu";
import { ProgressBar } from "@tenstorrent/vesper/progress-bar";
import {
  StatusIndicator,
  type StatusIndicatorState,
} from "@tenstorrent/vesper/status-indicator";
import { Tag } from "@tenstorrent/vesper/tag";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { DEPLOYMENTS_PATH } from "@/src/routes/route-config";
import type {
  DeviceStatus,
  HardwareDevice,
} from "@/src/vesper/hooks/use-hardware";
import { formatDeviceLabel } from "@/src/vesper/utils/models";

const STATUS: Record<
  DeviceStatus,
  { label: string; state: StatusIndicatorState; animated?: boolean }
> = {
  idle: { label: "Idle", state: "cancelled" },
  busy: { label: "Busy", state: "ready" },
  deploying: { label: "Deploying", state: "progress", animated: true },
  error: { label: "Error", state: "error" },
  resetting: { label: "Resetting", state: "progress", animated: true },
};

const TILE_COLOR: Record<DeviceStatus, string> = {
  idle: "bg-vesper-stone-300",
  busy: "bg-vesper-teal-500",
  deploying: "bg-vesper-amber-300",
  error: "bg-vesper-red-400",
  resetting: "bg-vesper-amber-300 animate-pulse",
};

/** The 2x2 grid glyph representing a device, colored by its status. */
function DeviceGlyph({
  status,
  linked,
}: {
  status: DeviceStatus;
  linked: boolean;
}) {
  return (
    <div className="w-12 h-12 flex items-center justify-center rounded-vesper-1 border border-vesper-border-secondary bg-vesper-background-secondary">
      {linked ? (
        <div
          className={cn(
            "w-[1.875rem] h-[1.875rem] rounded-vesper-half flex items-center justify-center",
            TILE_COLOR[status]
          )}
        >
          <Link className="w-5 h-5 text-vesper-icon-static-white" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-vesper-half">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-3.5 h-3.5 rounded-vesper-half",
                TILE_COLOR[status]
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  percent,
}: {
  label: string;
  value: string | null;
  percent: number | null;
}) {
  return (
    <div className="flex flex-col gap-vesper-2">
      <div className="flex items-center justify-between gap-vesper-2">
        <Typography variant="label-xs" className="text-vesper-text-secondary">
          {label}
        </Typography>
        <Typography
          variant="label-xs-mono"
          className="text-vesper-text-secondary"
        >
          {value ?? "---"}
        </Typography>
      </div>
      <ProgressBar size="sm" value={percent ?? 0} aria-label={label} />
    </div>
  );
}

const clampPercent = (value: number | null, max: number) =>
  value === null ? null : Math.max(0, Math.min(100, (value / max) * 100));

export function DeviceCard({
  device,
  linked,
  onReset,
  onViewLogs,
}: {
  device: HardwareDevice;
  /** Whether this device runs a deployment together with a neighbour */
  linked: boolean;
  onReset(device: HardwareDevice): void;
  onViewLogs(device: HardwareDevice): void;
}) {
  const navigate = useNavigate();
  const status = STATUS[device.status];
  const deployment = device.deployment;

  const menuItems: MenuItemProps[] = [];
  if (deployment) {
    menuItems.push({
      text: "View deployment",
      onSelect: () =>
        navigate(
          `${DEPLOYMENTS_PATH}?deployment=${encodeURIComponent(deployment.key)}`
        ),
    });
  }
  if (deployment?.containerId || deployment?.historyId) {
    menuItems.push({ text: "View logs", onSelect: () => onViewLogs(device) });
  }
  menuItems.push({
    text: "Reset device",
    style: "danger",
    onSelect: () => onReset(device),
  });

  return (
    <div
      className={cn(
        "w-60 flex flex-col gap-vesper-5 p-vesper-5 rounded-vesper-2 border bg-vesper-background-primary",
        linked || device.status === "busy"
          ? "border-vesper-border-accent-base"
          : "border-vesper-border-secondary"
      )}
    >
      <div className="flex items-center justify-between gap-vesper-5">
        <Tag size="md">{formatDeviceLabel(device.index)}</Tag>
        <Menu
          as={IconButton}
          size="xs"
          variant="ghost"
          icon={<Ellipses />}
          aria-label={`Actions for ${formatDeviceLabel(device.index)}`}
          align="end"
          items={menuItems}
        />
      </div>
      <div className="flex flex-col items-center gap-vesper-3">
        <DeviceGlyph status={device.status} linked={linked} />
        <StatusIndicator
          className="[&_.vesper-status-indicator-label]:font-vesper-mono [&_.vesper-status-indicator-label]:uppercase [&_.vesper-status-indicator-label]:text-xs [&_.vesper-status-indicator-label]:text-vesper-text-secondary"
          state={status.state}
          label={status.label}
          animated={status.animated}
        />
      </div>
      {device.status === "error" ? (
        <div className="flex flex-col gap-vesper-2 mt-auto">
          <Button
            type="button"
            size="sm"
            variant="danger"
            className="w-full"
            onClick={() => onReset(device)}
          >
            Reset device
          </Button>
          {(deployment?.containerId || deployment?.historyId) && (
            <Button
              type="button"
              size="sm"
              variant="subtle"
              className="w-full"
              onClick={() => onViewLogs(device)}
            >
              View logs
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-vesper-3">
          <Metric
            label="TEMP"
            value={
              device.temperature !== null
                ? `${device.temperature.toFixed(1)}°C`
                : null
            }
            percent={clampPercent(device.temperature, 100)}
          />
          <Metric
            label="POWER"
            value={
              device.power !== null ? `${device.power.toFixed(0)} W` : null
            }
            percent={clampPercent(device.power, 150)}
          />
          <Metric
            label="VOLTAGE"
            value={
              device.voltage !== null ? `${device.voltage.toFixed(2)} V` : null
            }
            percent={clampPercent(device.voltage, 1)}
          />
        </div>
      )}
    </div>
  );
}
