// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { Cpu } from "lucide-react";

interface ChipSlot {
  slot_id: number;
  status: "available" | "occupied";
  model_name?: string;
  deployment_id?: number;
  is_multi_chip?: boolean;
}

interface ChipStatusDisplayProps {
  boardType: string;
  totalSlots: number;
  slots: ChipSlot[];
  onStopModel?: (deploymentId: number) => void;
  className?: string;
}

export function ChipStatusDisplay({
  boardType,
  totalSlots,
  slots,
  onStopModel,
  className = "",
}: ChipStatusDisplayProps) {
  const availableCount = slots.filter((s) => s.status === "available").length;

  // Check if two adjacent slots are both occupied and multi-chip (connector line)
  const hasConnector = (index: number): boolean => {
    if (index >= slots.length - 1) return false;
    const curr = slots[index];
    const next = slots[index + 1];
    return (
      curr.status === "occupied" &&
      next.status === "occupied" &&
      !!curr.is_multi_chip &&
      !!next.is_multi_chip
    );
  };

  return (
    <div
      className={`p-4 rounded-lg border border-gray-700/50 bg-[#0a0e14] ${className}`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-gray-400 uppercase tracking-widest">
            {boardType}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
            {totalSlots} DEVICES
          </span>
        </div>
        <span className="text-xs font-mono text-gray-500">
          {availableCount}/{totalSlots} IDLE
        </span>
      </div>

      {/* Slot cards row */}
      <div className="flex flex-row gap-3 flex-wrap">
        {slots.map((slot, index) => {
          const isOccupied = slot.status === "occupied";
          const showConnector = hasConnector(index);

          return (
            <React.Fragment key={slot.slot_id}>
              {/* Slot card */}
              <div
                className={`
                  relative flex flex-col items-center p-4 rounded-lg min-w-[110px] flex-1
                  border transition-all duration-300
                  ${
                    isOccupied
                      ? "bg-[#0d1117] border-TT-purple-accent/70 shadow-[0_0_16px_rgba(124,104,250,0.3)]"
                      : "bg-[#0d1117] border-TT-purple/30 shadow-[0_0_12px_rgba(188,179,247,0.15)]"
                  }
                `}
              >
                {/* Slot header row */}
                <div className="flex items-center justify-between w-full mb-3">
                  <span className="text-xs font-mono font-bold text-gray-400 tracking-wider">
                    DEVICE {String(slot.slot_id).padStart(2, "0")}
                  </span>
                  <span
                    className={`
                      text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full
                      ${
                        isOccupied
                          ? "bg-TT-purple-shade/60 text-TT-purple border border-TT-purple-accent/40"
                          : "bg-gray-800/80 text-gray-400 border border-gray-600/40"
                      }
                    `}
                  >
                    {isOccupied ? "IN USE" : "IDLE"}
                  </span>
                </div>

                {/* Chip icon */}
                <div
                  className={`
                    my-2 p-2 rounded-lg
                    ${isOccupied ? "bg-TT-purple-shade/50" : "bg-gray-800/50"}
                  `}
                >
                  <Cpu
                    className={`w-12 h-12 ${isOccupied ? "text-TT-purple-accent" : "text-gray-600"}`}
                    strokeWidth={1.2}
                  />
                </div>

                {/* Model name (only if occupied) */}
                {isOccupied && slot.model_name && (
                  <div className="mt-2 w-full text-center">
                    <span
                      className="text-[10px] font-mono text-TT-purple/80 truncate block px-1"
                      title={slot.model_name}
                    >
                      {slot.model_name}
                    </span>
                  </div>
                )}

                {/* Stop button (optional) */}
                {isOccupied && onStopModel && slot.deployment_id && (
                  <button
                    onClick={() => onStopModel(slot.deployment_id!)}
                    className="mt-2 text-[10px] font-mono text-red-400 hover:text-red-300 underline"
                  >
                    STOP
                  </button>
                )}
              </div>

              {/* Connector between adjacent multi-chip slots */}
              {showConnector && (
                <div className="flex items-center self-center flex-shrink-0">
                  <div className="w-2 h-2 rounded-sm border border-TT-purple-accent/60 bg-TT-purple-shade/40" />
                  <div className="w-4 h-px bg-TT-purple-accent/40" />
                  <div className="w-2 h-2 rounded-sm border border-TT-purple-accent/60 bg-TT-purple-shade/40" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
