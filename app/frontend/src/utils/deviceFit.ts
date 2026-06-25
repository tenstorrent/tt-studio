// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Single source of truth for frontend device-placement rules, mirroring the
// backend chip allocator so the UI can show a model's availability and valid
// configurations before deploy instead of failing on the request.
//
// To support a new model or change which device configurations a model allows,
// edit getModelPlacement() below — nothing else in the frontend needs to change.

import { isLlama31_8BModel, isP300x2Board } from "./p300x2Placement";

export interface DeviceSlotLike {
  slot_id: number;
  status: string;
  model_name?: string;
}

// Models declare 1 (single device) or >1 (full board: slots 0..3).
export function isMultiChipModel(chipsRequired?: number): boolean {
  return (chipsRequired ?? 1) > 1;
}

// Slot ids a full-board model occupies on a board with `totalSlots` slots.
export function fullBoardSlots(totalSlots: number): number[] {
  const count = Math.min(4, Math.max(totalSlots, 1));
  return Array.from({ length: count }, (_, i) => i);
}

// Whether a model can deploy right now given current slot occupancy.
export function canModelFit(
  chipsRequired: number | undefined,
  slots: DeviceSlotLike[],
  totalSlots: number
): boolean {
  const occupied = new Set(
    slots.filter((s) => s.status === "occupied").map((s) => s.slot_id)
  );
  if (isMultiChipModel(chipsRequired)) {
    return fullBoardSlots(totalSlots).every((id) => !occupied.has(id));
  }
  return slots.some((s) => s.status === "available");
}

// Short reason shown when a model can't be deployed now (null when it fits).
export function modelFitReason(
  chipsRequired: number | undefined,
  slots: DeviceSlotLike[],
  totalSlots: number
): string | null {
  if (canModelFit(chipsRequired, slots, totalSlots)) return null;
  if (isMultiChipModel(chipsRequired)) {
    const occupants = Array.from(
      new Set(
        slots
          .filter((s) => s.status === "occupied")
          .map((s) => s.model_name || `device ${s.slot_id}`)
      )
    ).join(", ");
    const needed = fullBoardSlots(totalSlots).length;
    return occupants
      ? `Needs all ${needed} devices — in use by ${occupants}`
      : `Needs all ${needed} devices`;
  }
  return "All devices in use";
}

// What device configurations a model supports.
export interface ModelPlacement {
  allowsSingle: boolean; // may run on a single device
  allowsFullBoard: boolean; // may run across the whole board (slots 0..3)
  cardGroups: number[][]; // valid multi-device groups, e.g. P300x2 card pairs
}

// SINGLE SOURCE OF TRUTH for per-model device configurations.
// Add a branch here to support a new flexible/custom model.
export function getModelPlacement(
  modelName: string,
  chipsRequired: number,
  boardType?: string
): ModelPlacement {
  // Llama 3.1 8B on P300x2 runs on either P300 card (2 devices) or the full board.
  if (isP300x2Board(boardType) && isLlama31_8BModel(modelName)) {
    return { allowsSingle: false, allowsFullBoard: true, cardGroups: [[0, 1], [2, 3]] };
  }
  // Multi-chip models always take the full board.
  if (isMultiChipModel(chipsRequired)) {
    return { allowsSingle: false, allowsFullBoard: true, cardGroups: [] };
  }
  // Standard single-device models.
  return { allowsSingle: true, allowsFullBoard: false, cardGroups: [] };
}

// The card group (set of slots) a given slot belongs to; falls back to the slot itself.
export function cardGroupFor(slotId: number, cardGroups: number[][]): number[] {
  return cardGroups.find((g) => g.includes(slotId)) ?? [slotId];
}

// Slot a single-device model auto-allocates to: the lowest free slot, mirroring
// the backend allocator. undefined when no slot is free.
export function firstFreeSlot(slots: DeviceSlotLike[]): number | undefined {
  return slots
    .filter((s) => s.status === "available")
    .map((s) => s.slot_id)
    .sort((a, b) => a - b)[0];
}
