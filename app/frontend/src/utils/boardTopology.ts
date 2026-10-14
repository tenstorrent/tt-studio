// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * How a board's chip-status slots map onto physical cards.
 *
 * A "slot" is what /docker-api/chip-status/ reports: one addressable
 * /dev/tenstorrent/<n> device a model can be pinned to. That isn't always one
 * chip — an N300 card has two chips behind a single PCIe device, so it is one
 * slot with chipsPerCard = 2.
 */
export interface CardTopology {
  /** chip-status slots per physical card. */
  slotsPerCard: number;
  /** Physical chips on each card (can exceed slotsPerCard, e.g. N300). */
  chipsPerCard: number;
  /** Product name of one card, e.g. "P300". */
  cardModel: string;
}

// Keyed by upper-cased board type (the backend mixes casing: "P300x2", "N150X4").
// Slot counts mirror MULTI_CHIP_BOARD_SLOTS / _get_total_slots in
// app/backend/docker_control/chip_allocator.py — keep the two in sync.
// Boards not listed here (e.g. Galaxy) fall back to a single group of all slots.
const CARD_TOPOLOGY: Record<string, CardTopology> = {
  // Wormhole
  E150: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "E150" },
  N150: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "N150" },
  N150X4: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "N150" },
  N300: { slotsPerCard: 1, chipsPerCard: 2, cardModel: "N300" },
  N300X4: { slotsPerCard: 1, chipsPerCard: 2, cardModel: "N300" },
  T3K: { slotsPerCard: 1, chipsPerCard: 2, cardModel: "N300" },
  T3000: { slotsPerCard: 1, chipsPerCard: 2, cardModel: "N300" },
  // Blackhole
  P100: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "P100" },
  P150: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "P150" },
  P150X4: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "P150" },
  P150X8: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "P150" },
  // A lone P300 is allocated as a single slot even though it carries two chips.
  P300: { slotsPerCard: 1, chipsPerCard: 2, cardModel: "P300" },
  P300X2: { slotsPerCard: 2, chipsPerCard: 2, cardModel: "P300" },
  // P300C "compute" cards are single-chip: one tt-smi device == one slot.
  P300CX4: { slotsPerCard: 1, chipsPerCard: 1, cardModel: "P300C" },
};

/** Card layout for a board type, or null when it isn't known. */
export function getCardTopology(
  boardType?: string | null
): CardTopology | null {
  if (!boardType) return null;
  return CARD_TOPOLOGY[boardType.toUpperCase()] ?? null;
}
