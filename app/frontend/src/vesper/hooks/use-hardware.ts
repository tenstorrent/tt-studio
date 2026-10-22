// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from "react";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import type { ChipStatus } from "@/src/types/chipStatus";
import type { DeploymentItem } from "@/src/vesper/types";
import { useChipStatus } from "./use-chip-status";
import { useDeployments } from "./use-deployments";

export type DeviceStatus =
  | "idle"
  | "busy"
  | "deploying"
  | "error"
  | "resetting";

export interface HardwareDevice {
  /** Chip index as reported by tt-smi */
  index: number;
  boardType: string;
  temperature: number | null;
  power: number | null;
  voltage: number | null;
  status: DeviceStatus;
  /** The deployment running on (or deploying onto) this device */
  deployment?: DeploymentItem;
  /** Device slot that drives this chip, used for resets */
  slot: number;
}

export interface HardwareCard {
  index: number;
  /** e.g. `n300`, `p300c` */
  boardType: string;
  devices: HardwareDevice[];
}

/** Map a device slot (what deployments and resets address) onto chip indices. */
export function chipsForSlot(
  slot: number,
  chipStatus: Pick<ChipStatus, "total_slots" | "cards"> | null,
  chipCount: number
): number[] {
  const totalSlots = chipStatus?.total_slots ?? chipCount;
  if (totalSlots >= chipCount) return [slot];
  // fewer slots than chips: each slot drives a whole card (e.g. an n300 has two
  // chips behind one PCIe device)
  const cards = chipStatus?.cards;
  if (cards && cards.length === totalSlots) return cards[slot] ?? [slot];
  const perSlot = Math.max(1, Math.floor(chipCount / Math.max(totalSlots, 1)));
  return Array.from({ length: perSlot }, (_, i) => slot * perSlot + i);
}

function slotForChip(
  chip: number,
  chipStatus: Pick<ChipStatus, "total_slots" | "cards"> | null,
  chipCount: number
) {
  const totalSlots = chipStatus?.total_slots ?? chipCount;
  for (let slot = 0; slot < totalSlots; slot++) {
    if (chipsForSlot(slot, chipStatus, chipCount).includes(chip)) return slot;
  }
  return chip;
}

/** `n300 L` -> `n300` */
function cardBoardType(boardType: string) {
  return boardType.replace(/\s+[LR]$/i, "").trim() || boardType;
}

/**
 * The detected Tenstorrent hardware grouped into cards and devices, with each
 * device's status derived from the deployments running on it.
 */
export function useHardware() {
  const { deviceState, loading, error, refresh } = useDeviceState();
  const { chipStatus, refetch: refetchChipStatus } = useChipStatus();
  const { items } = useDeployments();

  const cards = useMemo<HardwareCard[]>(() => {
    const chips = deviceState?.devices ?? [];
    if (chips.length === 0) return [];

    // which deployment owns each chip
    const deploymentByChip = new Map<number, DeploymentItem>();
    for (const item of items) {
      if (item.state === "download-failed" || item.state === "deploy-failed")
        continue;
      for (const slot of item.deviceIds) {
        for (const chip of chipsForSlot(slot, chipStatus, chips.length)) {
          // prefer showing a live deployment over a dead one
          const existing = deploymentByChip.get(chip);
          if (!existing || existing.state === "error") {
            deploymentByChip.set(chip, item);
          }
        }
      }
    }
    const occupiedSlots = new Set(
      (chipStatus?.slots ?? [])
        .filter((s) => s.status === "occupied")
        .map((s) => s.slot_id)
    );

    const boardState = deviceState?.state;
    const toDevice = (index: number): HardwareDevice => {
      const chip = chips.find((c) => c.index === index);
      const slot = slotForChip(index, chipStatus, chips.length);
      const deployment = deploymentByChip.get(index);
      let status: DeviceStatus = "idle";
      if (boardState === "RESETTING") status = "resetting";
      else if (boardState === "BAD_STATE") status = "error";
      else if (deployment?.state === "active") status = "busy";
      else if (deployment?.state === "error") status = "error";
      else if (deployment) status = "deploying";
      else if (occupiedSlots.has(slot)) status = "busy";
      return {
        index,
        boardType: chip?.board_type ?? "unknown",
        temperature: chip?.temperature ?? null,
        power: chip?.power ?? null,
        voltage: chip?.voltage ?? null,
        status,
        deployment,
        slot,
      };
    };

    const indices = chips.map((c) => c.index).sort((a, b) => a - b);
    const groups =
      chipStatus?.cards && chipStatus.cards.length > 0
        ? chipStatus.cards
        : indices.map((i) => [i]);
    // chips the card grouping doesn't mention still need to be shown
    const grouped = new Set(groups.flat());
    const allGroups = [
      ...groups.map((g) => g.filter((i) => indices.includes(i))),
      ...indices.filter((i) => !grouped.has(i)).map((i) => [i]),
    ].filter((g) => g.length > 0);

    return allGroups.map((group, index) => {
      const devices = group.map(toDevice);
      return {
        index,
        boardType: cardBoardType(devices[0]?.boardType ?? "unknown"),
        devices,
      };
    });
  }, [deviceState, chipStatus, items]);

  return {
    cards,
    boardName: deviceState?.board_name ?? null,
    boardState: deviceState?.state ?? null,
    resetSuggested: deviceState?.reset_suggested ?? false,
    chipStatus,
    isDetecting: loading && !deviceState,
    error,
    rescan: () => {
      refresh();
      refetchChipStatus();
    },
  };
}
