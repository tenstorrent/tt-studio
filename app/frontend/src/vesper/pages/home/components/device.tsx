// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Tag } from "@tenstorrent/vesper/tag";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { cn } from "@/src/lib/utils";
import { BoardStat } from "./board-stat";
import { BoardStateIndicator } from "./board-state-indicator";
import { CardMenu } from "./card-menu";
import { TtSmiDevice } from "@/src/api/telemetryApi";

export interface BoardProps {
  device: TtSmiDevice;
  index: number;
}

export function Device({ device, index }: BoardProps) {
  let temp: number | null = parseFloat(device.telemetry.asic_temperature);
  if (Number.isNaN(temp)) temp = null;

  return (
    <div className="flex flex-col gap-vesper-2 flex-1 relative">
      <div
        className={cn(
          "p-vesper-5 flex flex-col gap-vesper-5 rounded-vesper-2 border",
          "bg-vesper-background-primary border-vesper-border-primary"
        )}
      >
        <div className="flex items-center justify-between">
          <Tag>{`D.${(index + 1).toString().padStart(2, '0')}`}</Tag>
          <CardMenu />
        </div>
        <div className="flex flex-col items-center gap-vesper-3">
          <BoardStateIndicator state="idle" />
          <StatusIndicator label="IDLE" state="cancelled" />
        </div>
        <div className="flex flex-col gap-vesper-3">
          <BoardStat
            name="Temp"
            value={temp === null ? 0 : Math.min(temp, 100)}
            valueText={temp === null ? "---" : temp + "°C"}
          />
        </div>
      </div>
    </div>
  );
}
