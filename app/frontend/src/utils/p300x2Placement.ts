// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface ChipStatusSlotLike {
  slot_id: number;
  status: string;
}

const LLAMA_P300X2_PAIR = [0, 1] as const;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[\s_]/g, "");
}

function toSortedUnique(ids: number[]): number[] {
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

export function isP300x2Board(boardType?: string | null): boolean {
  return boardType === "P300Cx2";
}

export function isLlama31_8BModel(modelNameOrId?: string | null): boolean {
  if (!modelNameOrId) return false;
  const token = normalizeToken(modelNameOrId);
  return token.includes("llama-3.1-8b") || token.includes("llama3.18b");
}

export function parseDeviceIds(deviceId?: string | number): number[] {
  if (deviceId === undefined || deviceId === null) {
    return [];
  }
  if (typeof deviceId === "number") {
    return Number.isFinite(deviceId) ? [deviceId] : [];
  }
  return deviceId
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id));
}

export function isCardPairSelection(deviceIds: number[]): boolean {
  const normalized = toSortedUnique(deviceIds);
  return normalized.length === 2 && normalized[0] === 0 && normalized[1] === 1;
}

export function pickPreferredAvailablePair(
  slots: ChipStatusSlotLike[] | null | undefined
): number[] | null {
  if (!slots || slots.length === 0) return null;
  const available = new Set(
    slots.filter((slot) => slot.status === "available").map((slot) => slot.slot_id)
  );
  if (LLAMA_P300X2_PAIR.every((slotId) => available.has(slotId))) {
    return [...LLAMA_P300X2_PAIR];
  }
  return null;
}
