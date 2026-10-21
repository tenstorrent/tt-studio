// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDeployments,
  type CanonicalDeployment,
} from "../api/modelsDeployedApis";
import { useDeviceState } from "./useDeviceState";
import { useRefresh } from "./useRefresh";
import { useActiveDeploymentsContext } from "../providers/ActiveDeploymentsContext";
import { getCardTopology } from "../utils/boardTopology";
import type {
  DeviceInfo,
  DeviceState,
  DeviceStateData,
} from "../contexts/DeviceStateContext";
import type { ChipStatus } from "../types/chipStatus";
import type { ActiveDeployment } from "./useActiveDeployments";

const CHIP_STATUS_URL = "/docker-api/chip-status/";

// ── Public types ────────────────────────────────────────────────────────────────

/**
 * Display status for one device. Board health comes first because the backend
 * only reports health per board, so a reset or bad state affects every device:
 * resetting > error > in_use > starting > idle / unknown.
 */
export type BoardDeviceStatus =
  | "idle" // free, board healthy
  | "in_use" // held by a deployment the backend knows about
  | "starting" // claimed by an in-flight deploy the backend hasn't reported yet
  | "resetting" // board/device reset in progress
  | "error" // board in BAD_STATE or not present
  | "unknown"; // free, but board health can't be determined

export type BoardDeploymentSource =
  | "managed" // deployed by TT-Studio
  | "external" // container TT-Studio didn't start that binds TT devices
  | "pending"; // in-flight deploy tracked by this session

export interface BoardDeployment {
  /** Stable key: `dep-<deploymentId>`, `name-<modelName>`, or `job-<jobId>`. */
  key: string;
  source: BoardDeploymentSource;
  /** Docker container id for a TT-Studio-managed deployment, else null. */
  containerId: string | null;
  modelName: string;
  deploymentId: number | null;
  jobId: string | null;
  port: number | null;
  /** Sorted device (slot) ids this deployment holds. */
  deviceIds: number[];
  /** Sorted card indexes this deployment touches. */
  cardIndexes: number[];
  /** True when the deployment holds more than one device. */
  isMultiDevice: boolean;
  /** True when the deployment's devices are spread over more than one card. */
  spansMultipleCards: boolean;
}

export interface BoardDevice {
  /** Slot id, i.e. /dev/tenstorrent/<id>. */
  id: number;
  cardIndex: number;
  status: BoardDeviceStatus;
  /** Deployment holding (or starting on) this device, if any. */
  deployment: BoardDeployment | null;
  /**
   * tt-smi telemetry for this device. Null when the board can't be read, or when
   * tt-smi's device count doesn't match the slot count (e.g. N300/T3K, where
   * tt-smi lists each chip but the allocator counts one slot per card), because
   * then we can't safely match them up by index.
   */
  telemetry: DeviceInfo | null;
}

export interface BoardCard {
  index: number;
  /** Product name of the card (e.g. "P300"), or the board type if unknown. */
  cardModel: string;
  /** Physical chips on the card; null when the board topology is unknown. */
  chipCount: number | null;
  devices: BoardDevice[];
  /** Distinct deployments touching this card, in device order. */
  deployments: BoardDeployment[];
  isInUse: boolean;
}

export interface BoardCardsSnapshot {
  boardType: string;
  boardName: string;
  /** Board-wide health. There is no per-device health signal from the backend. */
  boardState: DeviceState;
  resetSuggested: boolean;
  /**
   * False when the board type isn't in the topology table; `cards` is then a
   * single group containing every device.
   */
  isTopologyKnown: boolean;
  totalDevices: number;
  cards: BoardCard[];
  /** Every deployment on the board (managed, external, and placed pending deploys). */
  deployments: BoardDeployment[];
  /**
   * In-flight deploys whose devices aren't known yet (the backend auto-allocates
   * them). Once the backend reserves a device it shows up as `in_use` instead.
   */
  unplacedDeployments: BoardDeployment[];
  /** Raw tt-smi device list (one entry per chip tt-smi reports). */
  rawDevices: DeviceInfo[];
}

export interface UseBoardCardsOptions {
  /** chip-status poll interval when no deploys are in flight. Default 30s. */
  pollIntervalMs?: number;
  /** chip-status poll interval while deploys are in flight. Default 5s. */
  activePollIntervalMs?: number;
  /** Overlay this session's in-flight deploys as "starting". Default true. */
  includePendingDeployments?: boolean;
}

export interface UseBoardCardsResult {
  /** Null until chip-status has loaded once. */
  data: BoardCardsSnapshot | null;
  /** True until the first chip-status and device-state responses arrive. */
  loading: boolean;
  /** True while a user-initiated re-scan is in flight. */
  refreshing: boolean;
  /** Last fetch error. `data` keeps the last good snapshot when a poll fails. */
  error: string | null;
  /**
   * Raw /docker-api/deployments/ rows fetched alongside chip-status, exposed so
   * callers that need deployment status don't poll the same endpoint again.
   */
  canonicalDeployments: readonly CanonicalDeployment[];
  /** Re-fetch chip-status and device-state now as a user-initiated action. */
  refresh: () => Promise<void>;
}

// ── Pure derivation ─────────────────────────────────────────────────────────────

const sortedUnique = (ids: number[]) =>
  Array.from(new Set(ids)).sort((a, b) => a - b);

function resolveDeviceStatus(
  boardState: DeviceState,
  occupied: boolean,
  pending: boolean
): BoardDeviceStatus {
  if (boardState === "RESETTING") return "resetting";
  if (boardState === "BAD_STATE" || boardState === "NOT_PRESENT")
    return "error";
  if (occupied) return "in_use";
  if (pending) return "starting";
  return boardState === "HEALTHY" ? "idle" : "unknown";
}

/**
 * Combine chip-status, device-state and in-flight deploys into a card → device
 * view. This function has no side effects, so it can be tested on its own.
 */
export function buildBoardCards(
  chipStatus: ChipStatus,
  deviceState: DeviceStateData | null,
  activeDeployments: readonly ActiveDeployment[] = [],
  canonicalDeployments: readonly CanonicalDeployment[] = []
): BoardCardsSnapshot {
  const totalDevices = Math.max(0, chipStatus.total_slots ?? 0);
  const boardType =
    chipStatus.board_type || deviceState?.board_type || "unknown";
  const boardState: DeviceState = deviceState?.state ?? "UNKNOWN";
  const topology = getCardTopology(boardType);
  const slotsPerCard = topology?.slotsPerCard ?? Math.max(totalDevices, 1);
  const cardOf = (deviceId: number) => Math.floor(deviceId / slotsPerCard);
  const inRange = (id: number) =>
    Number.isInteger(id) && id >= 0 && id < totalDevices;

  const managedCanonical = canonicalDeployments.filter(
    (d) => d.source === "managed" && !d.is_pending
  );
  const canonicalByDeploymentId = new Map<number, CanonicalDeployment>();
  const canonicalByModelName = new Map<string, CanonicalDeployment>();
  for (const deployment of managedCanonical) {
    if (deployment.deployment_id != null) {
      canonicalByDeploymentId.set(deployment.deployment_id, deployment);
    }
    const modelName =
      deployment.deployment_model_name ??
      deployment.model_impl?.model_name ??
      deployment.name;
    if (modelName && !canonicalByModelName.has(modelName)) {
      canonicalByModelName.set(modelName, deployment);
    }
  }

  // 1. Deployments the backend reports. Group slots by deployment instead of
  //    trusting is_multi_chip, which is false for deployments pinned to several
  //    devices (e.g. --device-id 0,1).
  const byKey = new Map<string, BoardDeployment>();
  const keyBySlot = new Map<number, string>();
  for (const slot of chipStatus.slots ?? []) {
    if (slot.status !== "occupied" || !inRange(slot.slot_id)) continue;
    const modelName = slot.model_name || "Unknown model";
    const key =
      slot.deployment_id != null
        ? `dep-${slot.deployment_id}`
        : `name-${modelName}`;
    const canonical =
      slot.source === "external"
        ? null
        : slot.deployment_id != null
          ? (canonicalByDeploymentId.get(slot.deployment_id) ?? null)
          : (canonicalByModelName.get(modelName) ?? null);
    let dep = byKey.get(key);
    if (!dep) {
      dep = {
        key,
        source: slot.source === "external" ? "external" : "managed",
        containerId: canonical?.id ?? null,
        modelName,
        deploymentId: slot.deployment_id ?? null,
        jobId: null,
        port: slot.port ?? null,
        deviceIds: [],
        cardIndexes: [],
        isMultiDevice: false,
        spansMultipleCards: false,
      };
      byKey.set(key, dep);
    }
    dep.deviceIds.push(slot.slot_id);
    keyBySlot.set(slot.slot_id, key);
  }

  // 2. In-flight deploys. Only claim devices the backend doesn't already report;
  //    once it does, the backend's entry takes over.
  const unplacedDeployments: BoardDeployment[] = [];
  const pendingKeyBySlot = new Map<number, string>();
  for (const d of activeDeployments) {
    if (d.status !== "active") continue;
    const dep: BoardDeployment = {
      key: `job-${d.jobId}`,
      source: "pending",
      containerId: null,
      modelName: d.modelName,
      deploymentId: null,
      jobId: d.jobId,
      port: null,
      deviceIds: [],
      cardIndexes: [],
      isMultiDevice: false,
      spansMultipleCards: false,
    };
    if (d.deviceIds.length === 0) {
      unplacedDeployments.push(dep);
      continue;
    }
    const free = sortedUnique(d.deviceIds).filter(
      (id) => inRange(id) && !keyBySlot.has(id) && !pendingKeyBySlot.has(id)
    );
    if (free.length === 0) continue;
    dep.deviceIds = free;
    byKey.set(dep.key, dep);
    free.forEach((id) => pendingKeyBySlot.set(id, dep.key));
  }

  // 3. Fill in the derived fields on each deployment.
  for (const dep of [...byKey.values(), ...unplacedDeployments]) {
    dep.deviceIds = sortedUnique(dep.deviceIds);
    dep.cardIndexes = sortedUnique(dep.deviceIds.map(cardOf));
    dep.isMultiDevice = dep.deviceIds.length > 1;
    dep.spansMultipleCards = dep.cardIndexes.length > 1;
  }

  // 4. Devices and cards. Telemetry is matched by index only when the counts agree.
  const rawDevices = deviceState?.devices ?? [];
  const telemetryAligned = rawDevices.length === totalDevices;
  const cardCount =
    totalDevices > 0 ? Math.ceil(totalDevices / slotsPerCard) : 0;

  const cards: BoardCard[] = Array.from(
    { length: cardCount },
    (_, cardIndex) => {
      const devices: BoardDevice[] = [];
      const first = cardIndex * slotsPerCard;
      const last = Math.min(first + slotsPerCard, totalDevices);
      for (let id = first; id < last; id++) {
        const occupiedKey = keyBySlot.get(id);
        const pendingKey = pendingKeyBySlot.get(id);
        const depKey = occupiedKey ?? pendingKey;
        devices.push({
          id,
          cardIndex,
          status: resolveDeviceStatus(boardState, !!occupiedKey, !!pendingKey),
          deployment: depKey ? (byKey.get(depKey) ?? null) : null,
          telemetry: telemetryAligned
            ? (rawDevices.find((dev) => dev.index === id) ?? null)
            : null,
        });
      }

      const deployments: BoardDeployment[] = [];
      for (const device of devices) {
        if (device.deployment && !deployments.includes(device.deployment)) {
          deployments.push(device.deployment);
        }
      }

      return {
        index: cardIndex,
        cardModel: topology?.cardModel ?? boardType,
        chipCount: topology?.chipsPerCard ?? null,
        devices,
        deployments,
        isInUse: deployments.length > 0,
      };
    }
  );

  return {
    boardType,
    boardName: deviceState?.board_name || boardType,
    boardState,
    resetSuggested: deviceState?.reset_suggested ?? false,
    isTopologyKnown: topology !== null,
    totalDevices,
    cards,
    deployments: [...byKey.values()],
    unplacedDeployments,
    rawDevices,
  };
}

// ── Hook ────────────────────────────────────────────────────────────────────────

const NO_DEPLOYMENTS: readonly ActiveDeployment[] = [];

/**
 * Card-level view of the board: cards → devices, with occupancy, deployments
 * (single- or multi-device), board health and per-device telemetry.
 *
 * Sources:
 *  - /docker-api/chip-status/ (polled here) for device occupancy
 *  - useDeviceState() for board health and tt-smi telemetry
 *  - useActiveDeploymentsContext() for deploys this session still has in flight
 *
 * Must be used inside DeviceStateProvider, RefreshProvider and
 * ActiveDeploymentsProvider (all mounted at the app root).
 */
export function useBoardCards(
  options: UseBoardCardsOptions = {}
): UseBoardCardsResult {
  const {
    pollIntervalMs = 30_000,
    activePollIntervalMs = 5_000,
    includePendingDeployments = true,
  } = options;

  const {
    deviceState,
    loading: deviceStateLoading,
    error: deviceStateError,
    refresh: refreshDeviceState,
  } = useDeviceState();
  const { refreshTrigger, resetAllNonce } = useRefresh();
  const { deployments: activeDeployments } = useActiveDeploymentsContext();

  const [chipStatus, setChipStatus] = useState<ChipStatus | null>(null);
  const [canonicalDeployments, setCanonicalDeployments] = useState<
    readonly CanonicalDeployment[]
  >([]);
  const [chipStatusLoading, setChipStatusLoading] = useState(true);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [chipStatusError, setChipStatusError] = useState<string | null>(null);
  const [deploymentsError, setDeploymentsError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasFetchedOnceRef = useRef(false);

  // Start a new fetch and cancel any older one still in flight, so a slow
  // response can't overwrite newer data.
  const fetchChipStatus = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const [chipResult, deploymentsResult] = await Promise.allSettled([
        axios.get<ChipStatus>(CHIP_STATUS_URL, {
          signal: controller.signal,
        }),
        fetchDeployments(),
      ]);

      if (abortRef.current !== controller) return;

      if (chipResult.status === "fulfilled") {
        setChipStatus(chipResult.value.data);
        setChipStatusError(null);
      } else if (!axios.isCancel(chipResult.reason)) {
        setChipStatusError(
          chipResult.reason instanceof Error
            ? chipResult.reason.message
            : "Failed to load chip status"
        );
      }

      if (deploymentsResult.status === "fulfilled") {
        setCanonicalDeployments(deploymentsResult.value);
        setDeploymentsError(null);
      } else {
        setDeploymentsError(
          deploymentsResult.reason instanceof Error
            ? deploymentsResult.reason.message
            : "Failed to load deployments"
        );
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setChipStatusLoading(false);
        hasFetchedOnceRef.current = true;
      }
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Poll every pollIntervalMs, or every activePollIntervalMs while a deploy is
  // in flight so devices it claims show up quickly.
  const hasActiveDeploys = activeDeployments.some((d) => d.status === "active");
  const interval = hasActiveDeploys ? activePollIntervalMs : pollIntervalMs;
  useEffect(() => {
    void fetchChipStatus();
    const id = setInterval(() => void fetchChipStatus(), interval);
    return () => clearInterval(id);
  }, [fetchChipStatus, interval]);

  // Refetch right away when a deploy starts/resolves, a refresh or reset is
  // triggered, or board health changes. Skip the first run; the polling effect
  // already fetched on mount.
  const deploymentSignature = activeDeployments
    .map((d) => `${d.jobId}:${d.status}`)
    .join(",");
  const boardState = deviceState?.state;
  const triggersReadyRef = useRef(false);
  useEffect(() => {
    if (!triggersReadyRef.current) {
      triggersReadyRef.current = true;
      return;
    }
    void fetchChipStatus();
  }, [
    deploymentSignature,
    refreshTrigger,
    resetAllNonce,
    boardState,
    fetchChipStatus,
  ]);

  const pending = includePendingDeployments
    ? activeDeployments
    : NO_DEPLOYMENTS;
  const data = useMemo(
    () =>
      chipStatus
        ? buildBoardCards(chipStatus, deviceState, pending, canonicalDeployments)
        : null,
    [chipStatus, deviceState, pending, canonicalDeployments]
  );

  const refresh = useCallback(async () => {
    setManualRefreshing(true);
    try {
      refreshDeviceState();
      await fetchChipStatus();
    } finally {
      setManualRefreshing(false);
    }
  }, [refreshDeviceState, fetchChipStatus]);

  return {
    data,
    loading: chipStatusLoading || deviceStateLoading,
    refreshing: manualRefreshing,
    error: chipStatusError ?? deploymentsError ?? deviceStateError ?? null,
    canonicalDeployments,
    refresh,
  };
}
