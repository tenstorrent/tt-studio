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
