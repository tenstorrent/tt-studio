// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ChipStatus } from "@/src/types/chipStatus";
import {
  autoPlacementFor,
  deployabilityReason,
  fullBoardSlots,
  minDevicesFor,
  placementFor,
  profileForDevices,
} from "@/src/utils/deviceFit";
import type { DeployRequest } from "./hooks/use-deploy-model";
import type { CatalogModel } from "@/src/vesper/types";
import {
  getModelTask,
  getVerification,
  type Verification,
} from "@/src/vesper/utils/models";

export interface CatalogFilters {
  verification: Verification[];
  tasks: string[];
}

export const DEFAULT_FILTERS: CatalogFilters = {
  verification: [],
  tasks: [],
};

export function countActiveFilters(filters: CatalogFilters) {
  return filters.verification.length + filters.tasks.length;
}

export function applyCatalogFilters(
  models: CatalogModel[],
  filters: CatalogFilters
) {
  return models.filter(
    (model) =>
      (filters.verification.length === 0 ||
        filters.verification.includes(getVerification(model))) &&
      (filters.tasks.length === 0 ||
        filters.tasks.includes(getModelTask(model)))
  );
}

/** Models that can run on this board, best supported first. */
export function getCompatibleModels(catalog: CatalogModel[]) {
  const STATUS_ORDER: Record<string, number> = {
    COMPLETE: 0,
    FUNCTIONAL: 1,
    EXPERIMENTAL: 2,
  };
  return catalog
    .filter((m) => m.is_compatible !== false)
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status ?? ""] ?? 3) -
        (STATUS_ORDER[b.status ?? ""] ?? 3)
    );
}

export interface Deployability {
  /** Whether a deploy could be placed on the free devices right now */
  fits: boolean;
  /** Why it can't be, when it can't */
  reason: string | null;
  /** Devices the model needs at minimum */
  devices: number;
}

/** Whether a model can be deployed onto the currently free devices. */
export function getDeployability(
  model: CatalogModel,
  chipStatus: ChipStatus | null
): Deployability {
  const totalSlots = chipStatus?.total_slots ?? 4;
  const boardSize = fullBoardSlots(totalSlots).length;
  const devices = Math.min(minDevicesFor(model, totalSlots), boardSize);
  if (!chipStatus) return { fits: true, reason: null, devices };
  const placement = placementFor(model, chipStatus.board_type, totalSlots);
  const fits =
    autoPlacementFor(model, placement, chipStatus.slots, totalSlots) !== null;
  return {
    fits,
    reason: fits
      ? null
      : deployabilityReason(
          placement,
          minDevicesFor(model, totalSlots),
          chipStatus.slots,
          totalSlots
        ),
    devices,
  };
}

/** Large weights that Hugging Face often stalls on mid-deploy. */
export const LARGE_WEIGHTS_MODELS: Record<string, string> = {
  "FLUX.1-dev": "black-forest-labs/FLUX.1-dev",
  "FLUX.1-schnell": "black-forest-labs/FLUX.1-schnell",
  "Wan2.2-T2V-A14B-Diffusers": "Wan-AI/Wan2.2-T2V-A14B-Diffusers",
};

/**
 * A deploy request that lets the model land wherever it fits right now, exactly
 * as the original deploy wizard sent it in its default (non-advanced) mode.
 */
export function buildAutoDeployRequest(
  model: CatalogModel,
  chipStatus: ChipStatus | null
): DeployRequest {
  const totalSlots = chipStatus?.total_slots ?? 4;
  const placement = placementFor(model, chipStatus?.board_type, totalSlots);
  const auto = chipStatus
    ? autoPlacementFor(model, placement, chipStatus.slots, totalSlots)
    : null;
  const isFlexible = placement.cardGroups.length > 0;
  const fullBoardOptIn = placement.allowsSingle && placement.allowsFullBoard;
  const forceFullBoard = (isFlexible || fullBoardOptIn) && !!auto?.fullBoard;
  const deviceId =
    !forceFullBoard && isFlexible && auto && auto.deviceIds.length > 1
      ? auto.deviceIds.join(",")
      : undefined;
  const profile = auto?.deviceIds.length
    ? profileForDevices(model, auto.deviceIds.length, totalSlots)
    : undefined;
  return {
    modelId: model.id,
    modelName: model.name,
    deployModelId: profile?.id,
    deviceId,
    forceFullBoard,
    deviceIds: auto?.deviceIds ?? [],
  };
}
