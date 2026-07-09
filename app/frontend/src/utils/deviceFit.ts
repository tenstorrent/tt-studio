// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Single source of truth for frontend device-placement rules, mirroring the
// backend chip allocator so the UI can show a model's availability and valid
// configurations before deploy instead of failing on the request.
//
// To support a new model or change which device configurations a model allows,
// edit getModelPlacement() below — nothing else in the frontend needs to change.

import { isFluxModel, isLlama31_8BModel, isP300x2Board } from "./p300x2Placement";

export interface DeviceSlotLike {
  slot_id: number;
  status: string;
  model_name?: string;
}

// Wormhole mesh boards: a single-device-capable model deploys across the whole
// board by default (the backend selects the chips itself); only an explicit slot
// pick pins it to one constituent chip. Mirrors WHOLE_BOARD_DEFAULT_BOARDS in
// app/backend/docker_control/docker_utils.py — keep the two in sync.
const WHOLE_BOARD_DEFAULT_BOARDS = new Set([
  "T3K",
  "T3000",
  "N300X4",
  "N150X4",
  "GALAXY",
  "GALAXY_T3K",
]);

export function isWholeBoardDefaultBoard(boardType?: string): boolean {
  return !!boardType && WHOLE_BOARD_DEFAULT_BOARDS.has(boardType.toUpperCase());
}

// Multi-chip Blackhole boards are deliberately kept out of WHOLE_BOARD_DEFAULT_BOARDS
// so single-card models stay pinned to one card. But FLUX media models have no
// single-card spec on these boards, so the backend deploys them across the whole
// board anyway (see infer_inference_server_device in docker_control/docker_utils.py,
// where FLUX resolves to the mesh device and device_id is dropped). Mirror that here.
const MULTI_CHIP_BLACKHOLE_BOARDS = new Set(["P150X4", "P150X8", "P300X2", "P300CX4"]);

function isMultiChipBlackholeBoard(boardType?: string): boolean {
  return !!boardType && MULTI_CHIP_BLACKHOLE_BOARDS.has(boardType.toUpperCase());
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
  if (isMultiChipModel(chipsRequired) || placement.defaultsFullBoard) {
    return `Needs all ${fullBoardSlots(totalSlots).length} devices${suffix}`;
  }
  return "All devices in use";
}

// What device configurations a model supports.
export interface ModelPlacement {
  allowsSingle: boolean; // may run on a single device
  allowsFullBoard: boolean; // may run across the whole board (slots 0..3)
  cardGroups: number[][]; // valid multi-device groups, e.g. P300x2 card pairs
  // True when a single-device model deploys board-wide by default (Wormhole mesh
  // boards); auto mode previews and uses the whole board, advanced can pin a slot.
  defaultsFullBoard?: boolean;
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
  // FLUX has no single-card spec on multi-chip Blackhole boards, so the backend
  // deploys it across the whole board even though chips_required is 1.
  if (isFluxModel(modelName) && isMultiChipBlackholeBoard(boardType)) {
    return { allowsSingle: false, allowsFullBoard: true, cardGroups: [], defaultsFullBoard: true };
  }
  // Single-device models on Wormhole mesh boards deploy board-wide by default;
  // advanced config can still pin them to one constituent chip.
  if (isWholeBoardDefaultBoard(boardType)) {
    return {
      allowsSingle: true,
      allowsFullBoard: false,
      cardGroups: [],
      defaultsFullBoard: true,
    };
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
  if (placement.defaultsFullBoard) {
    // Wormhole mesh boards deploy single-device models across the whole board;
    // the backend requires every slot free for this (no single-slot fallback).
    return board.every(isFree) ? { deviceIds: board, fullBoard: true } : null;
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
