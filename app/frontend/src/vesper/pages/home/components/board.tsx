// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Tag } from "@tenstorrent/vesper/tag";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { cn } from "@/src/lib/utils";
import { DeviceBoardData } from "../types";
import { BoardStat } from "./board-stat";
import { BoardStateIndicator } from "./board-state-indicator";
import { CardMenu } from "./card-menu";

export interface BoardProps extends DeviceBoardData {
  index: number;
  linked: boolean;
}

export function Board({
  tag,
  state,
  cpu,
  ram,
  temp,
  linked,
}: DeviceBoardData & { linked: boolean }) {
  const metricsAvailable = state !== "idle" && state !== "deploying";

  return (
    <div className="flex flex-col gap-vesper-2 flex-1 relative">
      <div
        className={cn(
          "p-vesper-5 flex flex-col gap-vesper-5 rounded-vesper-2 border",
          state === "idle" &&
            "bg-vesper-background-secondary border-vesper-border-secondary",
          state !== "idle" &&
            "bg-vesper-background-primary border-vesper-border-primary",
          linked &&
            "bg-vesper-background-primary border-vesper-border-accent-base"
        )}
      >
        <div className="flex items-center justify-between">
          <Tag>{tag}</Tag>
          <CardMenu />
        </div>
        <div className="flex flex-col items-center gap-vesper-3">
          <BoardStateIndicator linked={linked} state={state} />
          <StatusIndicator
            label={state.toUpperCase()}
            animated={state !== "idle"}
            state={
              state === "busy"
                ? "ready"
                : state === "deploying"
                  ? "progress"
                  : state === "error"
                    ? "error"
                    : "cancelled"
            }
          />
        </div>
        <div className="flex flex-col gap-vesper-3">
          <BoardStat
            name="RAM"
            value={!metricsAvailable ? 0 : ram}
            valueText={!metricsAvailable ? "---" : `${ram.toFixed(1)}%`}
          />
          <BoardStat
            name="CPU"
            value={!metricsAvailable ? 0 : cpu}
            valueText={!metricsAvailable ? "---" : `${cpu.toFixed(1)}%`}
          />
          <BoardStat
            name="Temp"
            value={!metricsAvailable ? 0 : Math.min(temp, 100)}
            valueText={!metricsAvailable ? "---" : `${temp.toFixed(1)}°C`}
          />
        </div>
      </div>
    </div>
  );
}
