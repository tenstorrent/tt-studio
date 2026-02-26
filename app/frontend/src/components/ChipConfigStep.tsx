// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useEffect } from "react";
import axios from "axios";
import { Cpu, Layers } from "lucide-react";
import { useStepper } from "./ui/stepper";
import { ChipStatusDisplay } from "./ChipStatusDisplay";
import { Button } from "./ui/button";

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
  onConfirm: (mode: "single" | "multi", slotId: number) => void;
}

export function ChipConfigStep({ onConfirm }: ChipConfigStepProps) {
  const { nextStep } = useStepper();
  const [selectedMode, setSelectedMode] = useState<"single" | "multi" | null>(
    null
  );
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [chipStatus, setChipStatus] = useState<ChipStatus | null>(null);

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

  const handleModeSelect = (mode: "single" | "multi") => {
    setSelectedMode(mode);
    setSelectedSlot(null); // reset slot when mode changes
  };

  const needsSlotPicker =
    selectedMode === "single" &&
    chipStatus !== null &&
    chipStatus.total_slots > 1;

  const isConfirmDisabled =
    !selectedMode || (needsSlotPicker && selectedSlot === null);

  const handleConfirm = () => {
    if (isConfirmDisabled || !selectedMode) return;
    // Multi-chip always uses device_id 0; single uses the chosen slot
    const slotId =
      selectedMode === "multi" ? 0 : (selectedSlot ?? 0);
    onConfirm(selectedMode, slotId);
    nextStep();
  };

  return (
    <div className="w-full px-8 py-6 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
          Choose Chip Configuration
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select how many chips to use. This determines which models are
          available in the next step.
        </p>
      </div>

      {/* Mode selection cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* 1 Chip card */}
        <button
          type="button"
          onClick={() => handleModeSelect("single")}
          className={`
            relative text-left p-6 rounded-xl border-2 transition-all duration-200 cursor-pointer
            ${
              selectedMode === "single"
                ? "border-TT-purple-accent bg-TT-purple-shade/30 shadow-[0_0_20px_rgba(124,104,250,0.25)]"
                : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/60 hover:bg-TT-purple-shade/10"
            }
          `}
        >
          {selectedMode === "single" && (
            <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-TT-purple-accent shadow-[0_0_8px_rgba(124,104,250,0.8)]" />
          )}
          <div className="flex items-center gap-3 mb-3">
            <div
              className={`p-2 rounded-lg ${selectedMode === "single" ? "bg-TT-purple-shade/60" : "bg-gray-800"}`}
            >
              <Cpu
                className={`w-6 h-6 ${selectedMode === "single" ? "text-TT-purple-accent" : "text-gray-400"}`}
              />
            </div>
            <div>
              <div
                className={`font-mono font-bold text-base ${selectedMode === "single" ? "text-TT-purple" : "text-gray-200"}`}
              >
                1 Chip
              </div>
              <div className="text-xs text-gray-500 font-mono">
                N150 / N300
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            Deploy on a single chip. Best for 8B–13B parameter models.
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {["Llama-3.1-8B", "Mistral-7B", "Qwen-2.5"].map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded font-mono"
              >
                {tag}
              </span>
            ))}
          </div>
        </button>

        {/* All Chips / T3K card */}
        <button
          type="button"
          onClick={() => handleModeSelect("multi")}
          className={`
            relative text-left p-6 rounded-xl border-2 transition-all duration-200 cursor-pointer
            ${
              selectedMode === "multi"
                ? "border-TT-purple-accent bg-TT-purple-shade/30 shadow-[0_0_20px_rgba(124,104,250,0.25)]"
                : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/60 hover:bg-TT-purple-shade/10"
            }
          `}
        >
          {selectedMode === "multi" && (
            <div className="absolute top-3 right-3 w-3 h-3 rounded-full bg-TT-purple-accent shadow-[0_0_8px_rgba(124,104,250,0.8)]" />
          )}
          <div className="flex items-center gap-3 mb-3">
            <div
              className={`p-2 rounded-lg ${selectedMode === "multi" ? "bg-TT-purple-shade/60" : "bg-gray-800"}`}
            >
              <Layers
                className={`w-6 h-6 ${selectedMode === "multi" ? "text-TT-purple-accent" : "text-gray-400"}`}
              />
            </div>
            <div>
              <div
                className={`font-mono font-bold text-base ${selectedMode === "multi" ? "text-TT-purple" : "text-gray-200"}`}
              >
                All Chips (T3K)
              </div>
              <div className="text-xs text-gray-500 font-mono">4 × chips</div>
            </div>
          </div>
          <p className="text-sm text-gray-400 leading-relaxed">
            Deploy across all 4 chips. Required for 70B+ large models.
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {["Llama-3.1-70B", "DeepSeek-R1-70B", "FLUX.1"].map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded font-mono"
              >
                {tag}
              </span>
            ))}
          </div>
        </button>
      </div>

      {/* Slot picker — only shown when "1 Chip" is selected on a multi-slot board */}
      {needsSlotPicker && chipStatus && (
        <div>
          <h3 className="text-sm font-mono font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Select Chip Slot
          </h3>
          <div className="flex flex-row justify-center gap-3 flex-wrap">
            {chipStatus.slots.map((slot) => {
              const isAvailable = slot.status === "available";
              const isSelected = selectedSlot === slot.slot_id;
              return (
                <button
                  key={slot.slot_id}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => setSelectedSlot(slot.slot_id)}
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
                    SLOT {String(slot.slot_id).padStart(2, "0")}
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
          {selectedSlot !== null && (
            <p className="mt-2 text-xs font-mono text-TT-purple-accent">
              ✓ Slot {selectedSlot} selected — model will run on{" "}
              <code className="bg-gray-800 px-1 rounded">
                /dev/tenstorrent/{selectedSlot}
              </code>
            </p>
          )}
        </div>
      )}

      {/* Chip slot status */}
      <div>
        <h3 className="text-sm font-mono font-semibold text-gray-400 uppercase tracking-widest mb-3">
          Current Slot Status
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

      {/* Confirm button */}
      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={handleConfirm}
          disabled={isConfirmDisabled}
          className={`
            px-6 py-2 font-mono font-semibold transition-all duration-200
            ${
              !isConfirmDisabled
                ? "bg-TT-purple-accent hover:bg-TT-purple text-white shadow-[0_0_12px_rgba(124,104,250,0.3)]"
                : "bg-gray-800 text-gray-600 cursor-not-allowed"
            }
          `}
        >
          Continue →
        </Button>
      </div>
    </div>
  );
}
