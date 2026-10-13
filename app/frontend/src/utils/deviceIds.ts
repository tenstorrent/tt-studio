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

// Chips a model stop will reset: its own, plus the rest of its card when the
// other chips on it are free (the backend resets an idle card as a whole). This
// is only a preview; the dialog switches to the chips the backend reports once
// the reset starts.
export const resetDeviceIdsForStop = (
  deviceIds: number[] | undefined,
  chipStatus: { cards?: number[][]; slots: { slot_id: number; status: string }[] } | null,
): number[] | undefined => {
  const cards = chipStatus?.cards ?? [];
  if (!deviceIds || cards.length === 0) return deviceIds;
  const idle = new Set(
    chipStatus!.slots.filter((s) => s.status === "available").map((s) => s.slot_id),
  );
  const widened = new Set(deviceIds);
  for (const card of cards) {
    if (!card.some((id) => deviceIds.includes(id))) continue;
    if (card.every((id) => deviceIds.includes(id) || idle.has(id))) {
      card.forEach((id) => widened.add(id));
    }
  }
  return [...widened].sort((a, b) => a - b);
};
