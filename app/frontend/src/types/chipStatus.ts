// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
// This file incorporates work covered by the following copyright and permission notice:
// SPDX-FileCopyrightText: Copyright (c) 2023 shadcn
// PDX-License-Identifier: MIT

/** Status values returned for an individual chip slot. */
export type ChipSlotStatus = "available" | "occupied";

/** Runtime occupancy information for one chip slot. */
export interface ChipStatusSlot {
  slot_id: number;
  status: ChipSlotStatus;
  model_name?: string;
  port?: number;
  deployment_id?: number;
  is_multi_chip?: boolean;
}

/** Response shape returned by /docker-api/chip-status/. */
export interface ChipStatus {
  board_type: string;
  total_slots: number;
  slots: ChipStatusSlot[];
}
