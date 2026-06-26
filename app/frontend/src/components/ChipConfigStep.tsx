// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { Cpu, Layers } from "lucide-react";
import { ChipStatusDisplay } from "./ChipStatusDisplay";
import {
  ModelPlacement,
  canModelFit,
  cardGroupFor,
  fullBoardSlots,
} from "../utils/deviceFit";

interface ChipSlot {
  slot_id: number;
  status: "available" | "occupied";
  model_name?: string;
  deployment_id?: number;
  is_multi_chip?: boolean;
}

interface ChipStatus {
  board_type: string;
  total_slots: number;
  slots: ChipSlot[];
}

interface ChipConfigStepProps {
  // Receives the exact slots the user chose; empty means no valid selection yet.
  onConfirm: (slotIds: number[]) => void;
  placement: ModelPlacement;
}

export function ChipConfigStep({ onConfirm, placement }: ChipConfigStepProps) {
  const [selectedMode, setSelectedMode] = useState<"single" | "multi" | null>(
    null
  );
  const [selectedSlots, setSelectedSlots] = useState<number[]>([]);
  const [chipStatus, setChipStatus] = useState<ChipStatus | null>(null);

  const { allowsSingle, allowsFullBoard, cardGroups } = placement;
  const isGrouped = cardGroups.length > 0;
  // The "pick devices" card is offered for single-device and flexible (card-pair) models.
  const pickEnabled = allowsSingle || isGrouped;

  // Fetch chip status on mount and poll every 7 minutes
  useEffect(() => {
    const fetchChipStatus = async () => {
      try {
        const response = await axios.get("/docker-api/chip-status/");
        setChipStatus(response.data);
      } catch (error) {
        console.error("Error fetching chip status:", error);
      }
    };

    fetchChipStatus();
    const interval = setInterval(fetchChipStatus, 7 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Whether the whole board is free (required to run full-board).
  const multiBoardFree = useMemo(
    () =>
      chipStatus
        ? canModelFit(4, chipStatus.slots, chipStatus.total_slots)
        : false,
    [chipStatus]
  );
  // Slots the "All Devices" choice sends: the full board for flexible models,
  // or just the base slot for standard multi-chip models (backend allocates the rest).
  const multiSlots = useMemo(
    () => (isGrouped ? fullBoardSlots(chipStatus?.total_slots ?? 4) : [0]),
    [isGrouped, chipStatus]
  );

  // Pre-select the only valid mode for this model.
  useEffect(() => {
    setSelectedMode(pickEnabled ? "single" : "multi");
    setSelectedSlots([]);
  }, [pickEnabled]);

  // Keep the parent's device selection in sync; an empty selection leaves Deploy
  // disabled until a valid device is picked.
  useEffect(() => {
    if (selectedMode === "multi") {
      onConfirm(multiBoardFree ? multiSlots : []);
    } else if (selectedMode === "single") {
      onConfirm(selectedSlots);
    }
  }, [selectedMode, selectedSlots, multiBoardFree, multiSlots, onConfirm]);

  const slotIsAvailable = (slotId: number) => {
    if (!chipStatus) return false;
    // Flexible models occupy a whole card, so every slot in the group must be free.
    const group = isGrouped ? cardGroupFor(slotId, cardGroups) : [slotId];
    return group.every(
      (g) => chipStatus.slots.find((s) => s.slot_id === g)?.status === "available"
    );
  };

  const toggleSlot = (slotId: number) => {
    if (isGrouped) {
      const group = cardGroupFor(slotId, cardGroups);
      setSelectedSlots((prev) => {
        const selected = group.every((g) => prev.includes(g));
        return selected
          ? prev.filter((s) => !group.includes(s))
          : Array.from(new Set([...prev, ...group]));
      });
      return;
    }
    // Single-device models pick exactly one slot.
    setSelectedSlots([slotId]);
  };

  const needsSlotPicker =
    selectedMode === "single" &&
    chipStatus !== null &&
    chipStatus.total_slots > 1;

  const singleDisabled = !pickEnabled;
  const multiDisabled = !allowsFullBoard || !multiBoardFree;
  const multiReason = !allowsFullBoard
    ? "This model uses a single device"
    : !multiBoardFree
      ? `Needs all ${chipStatus ? fullBoardSlots(chipStatus.total_slots).length : 4} devices free`
      : null;
  const singleTitle = allowsSingle ? "1 Device" : "Single Card";
  const singleDescription = singleDisabled
    ? "This model requires all devices."
    : allowsSingle
      ? "Deploy on a single device. Best for 8B–13B parameter models."
      : "Deploy on one card (2 devices), or pick both for the full board.";

  return (
    <div className="w-full px-8 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
          Choose Device Configuration
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Only configurations valid for the selected model and currently free
          devices can be chosen.
        </p>
      </div>

      {/* Mode selection cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Single / card-pick card */}
        <button
          type="button"
          disabled={singleDisabled}
          onClick={() => !singleDisabled && setSelectedMode("single")}
          className={`
            relative text-left p-6 rounded-xl border-2 transition-all duration-200
            ${
              singleDisabled
                ? "border-gray-800 bg-[#0a0e14] opacity-40 cursor-not-allowed"
                : selectedMode === "single"
                  ? "border-TT-purple-accent bg-TT-purple-shade/30 shadow-[0_0_20px_rgba(124,104,250,0.25)] cursor-pointer"
                  : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/60 hover:bg-TT-purple-shade/10 cursor-pointer"
            }
          `}
        >
          {selectedMode === "single" && !singleDisabled && (
            <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-TT-purple-accent shadow-[0_0_8px_rgba(124,104,250,0.8)]" />
          )}
          <div className="flex items-center gap-3 mb-3">
            <div
              className={`p-2 rounded-lg ${selectedMode === "single" && !singleDisabled ? "bg-TT-purple-shade/60" : "bg-gray-800"}`}
            >
              <Cpu
                className={`w-6 h-6 ${selectedMode === "single" && !singleDisabled ? "text-TT-purple-accent" : "text-gray-400"}`}
              />
            </div>
            <div>
              <div
                className={`font-mono font-bold text-base ${selectedMode === "single" && !singleDisabled ? "text-TT-purple" : "text-gray-200"}`}
              >
                {singleTitle}
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">{singleDescription}</p>
        </button>

        {/* All Devices card */}
        <button
          type="button"
          disabled={multiDisabled}
          onClick={() => !multiDisabled && setSelectedMode("multi")}
          className={`
            relative text-left p-6 rounded-xl border-2 transition-all duration-200
            ${
              multiDisabled
                ? "border-gray-800 bg-[#0a0e14] opacity-40 cursor-not-allowed"
                : selectedMode === "multi"
                  ? "border-TT-purple-accent bg-TT-purple-shade/30 shadow-[0_0_20px_rgba(124,104,250,0.25)] cursor-pointer"
                  : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/60 hover:bg-TT-purple-shade/10 cursor-pointer"
            }
          `}
        >
          {selectedMode === "multi" && !multiDisabled && (
            <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-TT-purple-accent shadow-[0_0_8px_rgba(124,104,250,0.8)]" />
          )}
          <div className="flex items-center gap-3 mb-3">
            <div
              className={`p-2 rounded-lg ${selectedMode === "multi" && !multiDisabled ? "bg-TT-purple-shade/60" : "bg-gray-800"}`}
            >
              <Layers
                className={`w-6 h-6 ${selectedMode === "multi" && !multiDisabled ? "text-TT-purple-accent" : "text-gray-400"}`}
              />
            </div>
            <div>
              <div
                className={`font-mono font-bold text-base ${selectedMode === "multi" && !multiDisabled ? "text-TT-purple" : "text-gray-200"}`}
              >
                All Devices
              </div>
              <div className="text-xs text-gray-500 font-mono">4 × devices</div>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            {multiReason ?? "Deploy across all 4 devices. Required for 70B+ large models."}
          </p>
        </button>
      </div>

      {/* Slot picker — shown when the single/card mode is selected on a multi-slot board */}
      {needsSlotPicker && chipStatus && (
        <div>
          <h3 className="text-sm font-mono font-semibold text-gray-400 uppercase tracking-widest mb-1">
            Select Device(s)
          </h3>
          <p className="text-xs text-gray-500 font-mono mb-3">
            {isGrouped
              ? "Select a card (2 devices), or both cards for the full board."
              : "Select the device to deploy on."}
          </p>
          <div className="flex flex-row justify-center gap-3 flex-wrap">
            {chipStatus.slots.map((slot) => {
              const isAvailable = slotIsAvailable(slot.slot_id);
              const isSelected = selectedSlots.includes(slot.slot_id);
              return (
                <button
                  key={slot.slot_id}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => toggleSlot(slot.slot_id)}
                  className={`
                    flex flex-col items-center px-5 py-4 rounded-lg border-2 transition-all duration-200 min-w-[90px]
                    ${
                      isSelected
                        ? "border-TT-purple-accent bg-TT-purple-shade/40 shadow-[0_0_14px_rgba(124,104,250,0.3)]"
                        : isAvailable
                          ? "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/50 hover:bg-TT-purple-shade/10 cursor-pointer"
                          : "border-gray-800 bg-[#0a0e14] opacity-40 cursor-not-allowed"
                    }
                  `}
                >
                  <Cpu
                    className={`w-6 h-6 mb-1 ${isSelected ? "text-TT-purple-accent" : isAvailable ? "text-gray-400" : "text-gray-700"}`}
                    strokeWidth={1.4}
                  />
                  <span
                    className={`text-xs font-mono font-bold tracking-wider ${isSelected ? "text-TT-purple" : "text-gray-400"}`}
                  >
                    DEVICE {String(slot.slot_id).padStart(2, "0")}
                  </span>
                  <span
                    className={`text-[10px] font-mono mt-0.5 ${
                      isSelected
                        ? "text-TT-purple-accent"
                        : isAvailable
                          ? "text-gray-500"
                          : "text-gray-700"
                    }`}
                  >
                    {isAvailable ? "IDLE" : "IN USE"}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedSlots.length > 0 && (
            <p className="mt-2 text-xs font-mono text-TT-purple-accent">
              ✓ {selectedSlots.length > 1 ? `Devices ${selectedSlots.slice().sort((a,b)=>a-b).join(", ")} selected` : `Device ${selectedSlots[0]} selected`}
              {" — "}
              {selectedSlots.slice().sort((a,b)=>a-b).map((s) => (
                <code key={s} className="bg-gray-800 px-1 rounded mr-1">
                  /dev/tenstorrent/{s}
                </code>
              ))}
            </p>
          )}
        </div>
      )}

      {/* Chip slot status */}
      <div>
        <h3 className="text-sm font-mono font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Current Device Status
        </h3>
        {chipStatus ? (
          <ChipStatusDisplay
            boardType={chipStatus.board_type}
            totalSlots={chipStatus.total_slots}
            slots={chipStatus.slots}
          />
        ) : (
          <div className="p-4 rounded-lg border border-gray-700 bg-[#0d1117] text-gray-500 text-sm font-mono animate-pulse">
            Fetching hardware status...
          </div>
        )}
      </div>
    </div>
  );
}
