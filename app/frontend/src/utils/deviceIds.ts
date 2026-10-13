// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export const deviceIdsForRow = (row?: {
  device_ids?: number[];
  device_id?: number | null;
}): number[] | undefined => {
  if (!row) return undefined;
  if (Array.isArray(row.device_ids) && row.device_ids.length > 0)
    return row.device_ids;
  if (row.device_id != null) return [row.device_id];
  return undefined;
};

// P300x2 cards; each carries two chips that must be reset together.
const P300X2_CARDS = [
  [0, 1],
  [2, 3],
];

// Chips a model stop will reset: its own, plus the rest of its P300 card when
// nothing else is running there (the backend resets an idle card as a whole).
export const resetDeviceIdsForStop = (
  deviceIds: number[] | undefined,
  chipStatus: { board_type: string; slots: { slot_id: number; status: string }[] } | null,
): number[] | undefined => {
  if (!deviceIds || chipStatus?.board_type !== "P300x2") return deviceIds;
  const idle = new Set(
    chipStatus.slots.filter((s) => s.status === "available").map((s) => s.slot_id),
  );
  const widened = new Set(deviceIds);
  for (const card of P300X2_CARDS) {
    if (!card.some((id) => deviceIds.includes(id))) continue;
    if (card.every((id) => deviceIds.includes(id) || idle.has(id))) {
      card.forEach((id) => widened.add(id));
    }
  }
  return [...widened].sort((a, b) => a - b);
};

