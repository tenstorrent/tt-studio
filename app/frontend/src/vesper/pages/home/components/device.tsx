// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Tag } from "@tenstorrent/vesper/tag";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Menu } from "@tenstorrent/vesper/menu";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Typography } from "@tenstorrent/vesper/typography";
import { Document, Ellipses, Link, Reset } from "@tenstorrent/vesper/icons";
import { cn } from "@/src/lib/utils";
import { type BoardDevice } from "@/src/hooks/useBoardCards";
import { useResetDevice } from "@/src/hooks/useResetDevice";

export interface BoardProps {
  device: BoardDevice;
  index: number;
}

export function Device({ device, index }: BoardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const resetDevice = useResetDevice(device);

  const isResetting = resetDevice.state === "resetting";

  const resetDescription =
    resetDevice.disabledReason ??
    (device.deployment?.source === "managed"
      ? "Stops the deployed model and resets every device it occupies."
      : "Reset this device in place.");

  return (
    <div className="flex flex-col gap-vesper-2 flex-1 relative w-full max-w-[220px] mx-auto">
      <div
        className={cn(
          "p-vesper-5 flex flex-col gap-vesper-5 rounded-vesper-2 border",
          "bg-vesper-background-primary border-vesper-border-primary"
        )}
      >
        <div className="flex items-center justify-between">
          <Tag>{`D.${(index + 1).toString().padStart(2, "0")}`}</Tag>
          <Menu
            width={240}
            as={IconButton}
            icon={<Ellipses />}
            disabled={isResetting}
            size="xs"
            variant="ghost"
            className={cn(isMenuOpen && "bg-vesper-tint-neutral-200")}
            open={isMenuOpen}
            onOpenChange={setIsMenuOpen}
            items={[
              {
                icon: <Document />,
                text: "View Logs",
                description: "Coming soon.",
                onSelect() {},
                style: "disabled",
              },
              {
                icon: <Reset />,
                text: isResetting ? "Resetting…" : "Reset Device",
                description: resetDescription,
                onSelect() {
                  void resetDevice.reset();
                },
                style: resetDevice.canReset ? "danger" : "disabled",
              },
            ]}
          />
        </div>
        <DeviceStateIndicator device={device} resetting={isResetting} />
        <Typography
          variant="label-xs"
          className="text-vesper-text-secondary uppercase text-left"
        >
          {device.deployment === null ? "Free" : device.deployment.modelName}
        </Typography>
      </div>
    </div>
  );
}

function DeviceStateIndicator({
  device,
  linked,
  resetting,
}: {
  device: BoardDevice;
  linked?: boolean;
  resetting?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-vesper-3">
      <DeviceStatusIcon device={device} linked={linked} resetting={resetting} />
      <DeviceStatusIndicator device={device} resetting={resetting} />
    </div>
  );
}

function DeviceStatusIndicator({
  device,
  resetting,
}: {
  device: BoardDevice;
  resetting?: boolean;
}) {
  if (resetting) {
    return <StatusIndicator label="RESETTING" state="progress" animated />;
  }

  switch (device.status) {
    case "in_use":
      return <StatusIndicator label="IN USE" state="ready" animated />;
    case "starting":
      return <StatusIndicator label="STARTING" state="progress" animated />;
    case "resetting":
      return <StatusIndicator label="RESETTING" state="progress" animated />;
    case "error":
      return <StatusIndicator label="ERROR" state="error" />;
    case "unknown":
      return <StatusIndicator label="UNKNOWN" state="error" />;
    case "idle":
    default:
      return <StatusIndicator label="IDLE" state="cancelled" />;
  }
}

function DeviceStatusIcon({
  device,
  linked,
  resetting,
}: {
  device: BoardDevice;
  linked?: boolean;
  resetting?: boolean;
}) {
  const bgClassName = cn(
    device.status === "idle" && "bg-vesper-tint-neutral-400",
    device.status === "in_use" && "bg-vesper-background-accent-base",
    (resetting ||
      device.status === "starting" ||
      device.status === "resetting") &&
      "bg-vesper-background-warning-base",
    (device.status === "error" || device.status === "unknown") &&
      "bg-vesper-background-error-base"
  );

  return (
    <div className="size-12 flex items-center justify-center border border-vesper-border-secondary rounded-vesper-1 bg-vesper-background-secondary">
      {linked ? (
        <div
          className={cn(
            "size-7.5 flex items-center justify-center rounded-vesper-half",
            bgClassName
          )}
        >
          <Link className="text-vesper-text-primary w-6 h-6" />
        </div>
      ) : (
        <div className="size-7.5 flex flex-wrap gap-vesper-half">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className={cn("size-3.5 rounded-vesper-half", bgClassName)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
