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
  if (isMultiChipModel(chipsRequired)) {
    // The backend rejects a full-board deploy if ANY slot on the board is occupied,
    // so require every slot free — not just slots 0..3 (matters on >4-slot boards).
    return slots
      .filter((s) => s.slot_id < totalSlots)
      .every((s) => s.status === "available");
  }
  return slots.some((s) => s.status === "available");
}

// Reason a model can't be auto-deployed against current occupancy (null when it can).
// Placement-aware: flexible models need a free card pair / full board, not just any slot.
export function deployabilityReason(
  placement: ModelPlacement,
  chipsRequired: number,
  slots: DeviceSlotLike[],
  totalSlots: number
): string | null {
  if (autoPlacement(placement, chipsRequired, slots, totalSlots) !== null) return null;
  const occupants = Array.from(
    new Set(
      slots
        .filter((s) => s.status === "occupied")
        .map((s) => s.model_name || `device ${s.slot_id}`)
    )
  ).join(", ");
  const suffix = occupants ? ` — in use by ${occupants}` : "";
  if (placement.cardGroups.length > 0) return `Needs a free card pair${suffix}`;
  if (isMultiChipModel(chipsRequired)) {
    return `Needs all ${fullBoardSlots(totalSlots).length} devices${suffix}`;
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

// Devices an automatic (non-manual) deploy will use, given current occupancy:
// prefer the full board, then any fully-free card group (flexible models), else
// the lowest free slot (single-device). Returns null when nothing fits.
export function autoPlacement(
  placement: ModelPlacement,
  chipsRequired: number,
  slots: DeviceSlotLike[],
  totalSlots: number
): { deviceIds: number[]; fullBoard: boolean } | null {
  const board = fullBoardSlots(totalSlots);
  const isFree = (id: number) =>
    slots.find((s) => s.slot_id === id)?.status === "available";

  if (placement.cardGroups.length > 0) {
    if (board.every(isFree)) return { deviceIds: board, fullBoard: true };
    for (const group of placement.cardGroups) {
      if (group.every(isFree)) return { deviceIds: group, fullBoard: false };
    }
    return null;
  }
  if (isMultiChipModel(chipsRequired)) {
    // Full-board models need the whole board free (see canModelFit).
    return canModelFit(chipsRequired, slots, totalSlots)
      ? { deviceIds: board, fullBoard: true }
      : null;
  }
  const slot = firstFreeSlot(slots);
  return slot === undefined ? null : { deviceIds: [slot], fullBoard: false };
}
