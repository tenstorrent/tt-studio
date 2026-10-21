// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalDeployment } from "@/src/api/modelsDeployedApis";
import type { StartupPhase } from "@/src/components/HealthBadge";
import {
  useBoardCards,
  type BoardDeployment,
  type BoardDevice,
} from "@/src/hooks/useBoardCards";
import type {
  ActiveDeployment,
  DeploymentProgressData,
} from "@/src/hooks/useActiveDeployments";
import { compactPercent } from "@/src/lib/deployProgress";
import { useActiveDeploymentsContext } from "@/src/providers/ActiveDeploymentsContext";
import {
  autoPlacementFor,
  deployabilityReason,
  fullBoardSlots,
  minDevicesFor,
  placementFor,
  type DeviceSlotLike,
  type ServeProfile,
} from "@/src/utils/deviceFit";

// ── Models ──────────────────────────────────────────────────────────────────────

export type ModelTask =
  | "text-to-text"
  | "image-text-to-text"
  | "text-to-image"
  | "text-to-video"
  | "text-to-speech"
  | "speech-to-text"
  | "object-detection"
  | "face-recognition"
  | "image-classification"
  | "embedding"
  | "training"
  | "unknown";

export const MODEL_TASK_LABELS: Record<ModelTask, string> = {
  "text-to-text": "Text-to-Text",
  "image-text-to-text": "Image-Text-to-Text",
  "text-to-image": "Text-to-Image",
  "text-to-video": "Text-to-Video",
  "text-to-speech": "Text-to-Speech",
  "speech-to-text": "Speech-to-Text",
  "object-detection": "Object Detection",
  "face-recognition": "Face Recognition",
  "image-classification": "Image Classification",
  embedding: "Embedding",
  training: "Training",
  unknown: "Unknown",
};

// Backend ModelTypes (shared_config/model_type_config.py) → task.
const TASK_BY_MODEL_TYPE: Record<string, ModelTask> = {
  chat: "text-to-text",
  vlm: "image-text-to-text",
  image_generation: "text-to-image",
  video_generation: "text-to-video",
  tts: "text-to-speech",
  speech_recognition: "speech-to-text",
  object_detection: "object-detection",
  face_recognition: "face-recognition",
  cnn: "image-classification",
  embedding: "embedding",
  training: "training",
};

export function taskForModelType(modelType: string | null | undefined): ModelTask {
  return TASK_BY_MODEL_TYPE[(modelType ?? "").toLowerCase()] ?? "unknown";
}

/** Row shape returned by /docker-api/get_containers/ (docker_control ContainersView). */
interface CatalogApiModel {
  id: string;
  name: string;
  is_compatible: boolean | null;
  compatible_boards: string[];
  model_type: string;
  display_model_type?: string | null;
  current_board: string;
  status?: "EXPERIMENTAL" | "FUNCTIONAL" | "COMPLETE" | null;
  chips_required?: number;
  hf_model_id?: string | null;
  source?: "inference-server" | "community" | string;
  author?: string | null;
  profiles?: ServeProfile[];
  profile?: string;
  no_page_reason?: string | null;
  /** Not sent by the backend yet; read here so it lights up once it is. */
  description?: string | null;
}

export interface DeployableModel {
  id: string;
  name: string;
  /** Null until the backend catalog carries descriptions. */
  description: string | null;
  tasks: ModelTask[];
  /** Raw backend model_type (e.g. "chat", "tts"). */
  modelType: string;
  displayModelType: string | null;
  /** Fewest devices the model can deploy on, on this board. */
  requiredDevices: number;
  /** Every device count the model can deploy on here, ascending (e.g. [1, 2, 4]). */
  deviceOptions: number[];
  /** Null when the board type couldn't be detected. */
  isCompatible: boolean | null;
  compatibleBoards: string[];
  /** Support status from the inference-server catalog. */
  status: "EXPERIMENTAL" | "FUNCTIONAL" | "COMPLETE" | null;
  source: "inference-server" | "community" | string;
  author: string | null;
  hfModelId: string | null;
  /** Why the model has no interaction page in TT Studio (it can still be deployed). */
  noPageReason: string | null;
  /** True when the free devices can take this model right now. */
  canDeploy: boolean;
  /** Why it can't deploy right now (incompatible, or devices in use), else null. */
  deployBlockedReason: string | null;
  /** Current deployments of this model (any state). */
  deployments: ModelDeployment[];
  /** Raw catalog row, for anything the deploy call needs (profiles, etc.). */
  raw: CatalogApiModel;
}

// ── Deployments ─────────────────────────────────────────────────────────────────

export type DeploymentState =
  | "queued" // waiting for another deploy to release the inference server's run lock
  | "pulling_image"
  | "downloading" // model weights downloading (before or inside the container)
  | "download_failed"
  | "deploying" // container being created/started
  | "deploy_failed"
  | "cancelled"
  | "warming_up" // container running, model not ready to serve yet
  | "active" // ready to serve
  | "error" // container crashed/exited, or its readiness probe reports unavailable
  | "stopped" // stopped by the user
  | "unknown";

export const DEPLOYMENT_STATE_LABELS: Record<DeploymentState, string> = {
  queued: "Queued",
  pulling_image: "Pulling image",
  downloading: "Downloading",
  download_failed: "Download failed",
  deploying: "Deploying",
  deploy_failed: "Deploy failed",
  cancelled: "Cancelled",
  warming_up: "Warming up",
  active: "Active",
  error: "Error",
  stopped: "Stopped",
  unknown: "Unknown",
};

export type DeploymentPhase = "in_progress" | "ready" | "failed" | "inactive";

export const DEPLOYMENT_STATE_PHASE: Record<DeploymentState, DeploymentPhase> = {
  queued: "in_progress",
  pulling_image: "in_progress",
  downloading: "in_progress",
  deploying: "in_progress",
  warming_up: "in_progress",
  active: "ready",
  download_failed: "failed",
  deploy_failed: "failed",
  error: "failed",
  cancelled: "inactive",
  stopped: "inactive",
  unknown: "inactive",
};

export type DeploymentSource =
  | "managed" // deployed by TT-Studio
  | "external" // container TT-Studio didn't start that holds TT devices
  | "pending"; // in-flight deploy that has no container yet

export interface ModelDeployment {
  /** Stable React key. */
  key: string;
  state: DeploymentState;
  stateLabel: string;
  phase: DeploymentPhase;
  /** Backend detail for the current state (error message, startup phase label, …). */
  message: string | null;
  /** 0–100 while the deploy is in progress, else null. */
  progress: number | null;
  source: DeploymentSource;
  /** Catalog model id, when it could be resolved. */
  modelId: string | null;
  modelName: string;
  /** Catalog entry for the deployed model, when it could be resolved. */
  model: DeployableModel | null;
  /** Sorted device ids the deployment holds (or will hold). */
  deviceIds: number[];
  /** False while an auto-allocated deploy hasn't been assigned devices yet. */
  devicesKnown: boolean;
  cardIndexes: number[];
  containerId: string | null;
  deploymentId: number | null;
  jobId: string | null;
  port: number | null;
  /** Epoch ms the deploy started, when known. */
  startedAt: number | null;
  /** Served from the backend's cache because docker-control is unreachable. */
  stale: boolean;
  /** Failed/cancelled deploy jobs can be dismissed via `dismissDeployment`. */
  dismissible: boolean;
  /** Raw deploy-job progress payload (bytes, speed, ETA, …), if any. */
  jobProgress: DeploymentProgressData | null;
  /** Raw readiness-probe startup phase (warmup / in-container download), if any. */
  startupPhase: StartupPhase | null;
}

// ── Devices ─────────────────────────────────────────────────────────────────────

export interface ModelsDeployedDevices {
  all: BoardDevice[];
  /** Held by a deployment, or claimed by an in-flight deploy. */
  used: BoardDevice[];
  /** Free to deploy on. */
  available: BoardDevice[];
  /** Neither used nor available (board resetting or in a bad state). */
  unavailable: BoardDevice[];
  total: number;
}

// ── Hook result ─────────────────────────────────────────────────────────────────

export interface ModelsDeployedData {
  models: DeployableModel[];
  deployments: ModelDeployment[];
  devices: ModelsDeployedDevices;
  boardType: string | null;
  /** True until the catalog and the first board/deployment snapshot have loaded. */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Remove a failed/cancelled deploy job from the list. */
  dismissDeployment: (key: string) => void;
}

export interface UseModelsDeployedOptions {
  /** chip-status + deployments poll interval. Default 5s. */
  pollIntervalMs?: number;
  /** Readiness probe interval for running containers. Default 5s. */
  healthPollIntervalMs?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────────

const CATALOG_URL = "/docker-api/get_containers/";
const HEALTH_URL = "/models-api/health/";
const DOWNLOAD_STAGES = new Set(["pulling_image", "model_preparation"]);
const UNTRACKED_STAGES = new Set(["error", "cancelled", "complete", "unknown", ""]);
// A container started up to this long before a job's recorded start still counts
// as that job's container (clock skew between browser and backend).
const JOB_CONTAINER_SLACK_MS = 2 * 60 * 1000;

type Readiness = "healthy" | "starting" | "unavailable" | "unknown";
interface HealthEntry {
  readiness: Readiness;
  phase: StartupPhase | null;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

const sortedUnique = (ids: number[]) =>
  Array.from(new Set(ids)).sort((a, b) => a - b);

const parseTime = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

function canonicalModelId(d: CanonicalDeployment): string | null {
  const top = (d as unknown as { model_id?: unknown }).model_id;
  if (typeof top === "string" && top) return top;
  const impl = d.model_impl?.model_id;
  return typeof impl === "string" && impl ? impl : null;
}

function canonicalModelName(d: CanonicalDeployment): string {
  return (
    d.deployment_model_name ?? d.model_impl?.model_name ?? d.name ?? "Unknown model"
  );
}

function canonicalPort(d: CanonicalDeployment): number | null {
  for (const bindings of Object.values(d.port_bindings ?? {})) {
    const port = Number(bindings?.[0]?.HostPort);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return null;
}

function deviceCountOptions(
  raw: CatalogApiModel,
  boardType: string | undefined,
  totalSlots: number
): number[] {
  const placement = placementFor(raw, boardType, totalSlots);
  const options: number[] = [];
  if (placement.allowsSingle) options.push(1);
  for (const group of [...placement.cardGroups, ...(placement.pairGroups ?? [])]) {
    options.push(group.length);
  }
  if (placement.allowsFullBoard) options.push(fullBoardSlots(totalSlots).length);
  const unique = sortedUnique(options);
  return unique.length > 0 ? unique : [minDevicesFor(raw, totalSlots)];
}

function stateFromJob(
  job: ActiveDeployment,
  progress: DeploymentProgressData | null,
  lastStage: string | undefined
): { state: DeploymentState; message: string | null; progress: number | null } {
  const message = progress?.message || null;
  if (job.status === "failed") {
    if (progress?.status === "cancelled") return { state: "cancelled", message, progress: null };
    // The terminal payload's stage is usually "error", so fall back to the last
    // in-progress stage this hook saw.
    const stage = lastStage ?? progress?.stage ?? "";
    return {
      state: DOWNLOAD_STAGES.has(stage) ? "download_failed" : "deploy_failed",
      message,
      progress: null,
    };
  }
  // Completed jobs linger briefly; the container (if matched) takes over before then.
  if (job.status === "completed") return { state: "warming_up", message, progress: null };

  const pct = compactPercent(progress, false, job.hadImagePull);
  if (!progress) return { state: "deploying", message, progress: pct };
  if (progress.waiting_for_job_id) return { state: "queued", message, progress: pct };
  if (progress.stage === "pulling_image") return { state: "pulling_image", message, progress: pct };
  if (
    progress.stage === "model_preparation" &&
    progress.expects_weights !== false &&
    !progress.weights_cached
  ) {
    return { state: "downloading", message, progress: pct };
  }
  return { state: "deploying", message, progress: pct };
}

function stateFromContainer(
  d: CanonicalDeployment,
  health: HealthEntry | undefined,
  lastPhase: string | undefined
): { state: DeploymentState; message: string | null; progress: number | null } {
  const status = (d.status ?? "").toLowerCase();
  const phase = health?.phase ?? null;

  if (d.source === "docker_only") {
    return { state: status === "running" ? "active" : "stopped", message: null, progress: null };
  }
  if (d.stopped_by_user) return { state: "stopped", message: null, progress: null };
  if (status === "exited" || status === "dead") {
    return {
      state: lastPhase === "downloading_weights" ? "download_failed" : "error",
      message: `Container ${status}`,
      progress: null,
    };
  }
  if (status === "paused") return { state: "stopped", message: "Container paused", progress: null };
  if (status === "created" || status === "restarting" || status === "starting") {
    return { state: "deploying", message: null, progress: null };
  }
  if (status !== "running") return { state: "unknown", message: d.status || null, progress: null };

  switch (health?.readiness) {
    case "healthy":
      return { state: "active", message: null, progress: null };
    case "unavailable":
      return { state: "error", message: "Model is unavailable", progress: null };
    case "starting":
      return {
        state: phase?.phase === "downloading_weights" ? "downloading" : "warming_up",
        message: phase?.phase_label || phase?.message || null,
        progress: typeof phase?.progress === "number" ? Math.round(phase.progress) : null,
      };
    default:
      // No readiness answer yet: Docker's own health is the best hint we have.
      if ((d.health ?? "").toLowerCase() === "unhealthy") {
        return { state: "error", message: "Container unhealthy", progress: null };
      }
      return { state: "warming_up", message: null, progress: null };
  }
}

async function probeReadiness(containerId: string): Promise<HealthEntry> {
  try {
    const res = await fetch(`${HEALTH_URL}?deploy_id=${encodeURIComponent(containerId)}`);
    if (res.status === 200) return { readiness: "healthy", phase: null };
    if (res.status === 202) {
      let phase: StartupPhase | null = null;
      try {
        phase = ((await res.json())?.phase as StartupPhase) ?? null;
      } catch {
        phase = null;
      }
      return { readiness: "starting", phase };
    }
    if (res.status === 503) return { readiness: "unavailable", phase: null };
  } catch {
    // fall through
  }
  return { readiness: "unknown", phase: null };
}

// ── Hook ────────────────────────────────────────────────────────────────────────

/**
 * Everything the /models-deployed page needs: the model catalog (with tasks and
 * device requirements), every deployment with a single derived state, and the
 * board's used/available devices.
 *
 * Sources:
 *  - /docker-api/get_containers/          model catalog (fetched on mount + refresh)
 *  - useBoardCards()                      device occupancy + /docker-api/deployments/
 *  - useActiveDeploymentsContext()        in-flight deploy jobs and their progress
 *  - /models-api/health/?deploy_id=…      readiness (warming up vs. active)
 *
 * Must be used inside DeviceStateProvider, RefreshProvider and
 * ActiveDeploymentsProvider (all mounted at the app root).
 */
export function useModelsDeployed(
  options: UseModelsDeployedOptions = {}
): ModelsDeployedData {
  const { pollIntervalMs = 5_000, healthPollIntervalMs = 5_000 } = options;

  const board = useBoardCards({
    pollIntervalMs,
    activePollIntervalMs: Math.min(pollIntervalMs, 5_000),
  });
  const {
    deployments: jobs,
    progressByJob,
    removeDeployment,
  } = useActiveDeploymentsContext();

  // ── Catalog ──
  const [catalog, setCatalog] = useState<CatalogApiModel[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);

  const fetchCatalog = useCallback(async () => {
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    try {
      const res = await axios.get<CatalogApiModel[]>(CATALOG_URL, {
        signal: controller.signal,
      });
      if (catalogAbortRef.current !== controller) return;
      setCatalog(Array.isArray(res.data) ? res.data : []);
      setCatalogError(null);
    } catch (e) {
      if (axios.isCancel(e) || catalogAbortRef.current !== controller) return;
      setCatalogError(e instanceof Error ? e.message : "Failed to load models");
      setCatalog((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void fetchCatalog();
    return () => catalogAbortRef.current?.abort();
  }, [fetchCatalog]);

  // ── Readiness probes for running managed containers ──
  const canonical = board.canonicalDeployments;
  const probeIdsKey = useMemo(
    () =>
      canonical
        .filter(
          (d) =>
            d.source === "managed" &&
            !d.is_pending &&
            !d.stopped_by_user &&
            (d.status ?? "").toLowerCase() === "running"
        )
        .map((d) => d.id)
        .sort()
        .join(","),
    [canonical]
  );
  const [healthById, setHealthById] = useState<Record<string, HealthEntry>>({});

  useEffect(() => {
    const ids = probeIdsKey ? probeIdsKey.split(",") : [];
    if (ids.length === 0) {
      setHealthById({});
      return;
    }
    let cancelled = false;
    const probe = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => [id, await probeReadiness(id)] as const)
      );
      if (!cancelled) setHealthById(Object.fromEntries(entries));
    };
    void probe();
    const timer = setInterval(() => void probe(), healthPollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [probeIdsKey, healthPollIntervalMs]);

  // ── Remember the last in-progress stage/phase so a failure can be attributed
  //    to the download or the deploy (the terminal payload only says "error"). ──
  const [lastStageByJob, setLastStageByJob] = useState<Record<string, string>>({});
  useEffect(() => {
    setLastStageByJob((prev) => {
      let next = prev;
      for (const [jobId, p] of Object.entries(progressByJob)) {
        if (!p?.stage || UNTRACKED_STAGES.has(p.stage) || prev[jobId] === p.stage) continue;
        if (next === prev) next = { ...prev };
        next[jobId] = p.stage;
      }
      return next;
    });
  }, [progressByJob]);

  const [lastPhaseByContainer, setLastPhaseByContainer] = useState<Record<string, string>>({});
  useEffect(() => {
    setLastPhaseByContainer((prev) => {
      let next = prev;
      for (const [id, h] of Object.entries(healthById)) {
        const phase = h.phase?.phase;
        if (!phase || prev[id] === phase) continue;
        if (next === prev) next = { ...prev };
        next[id] = phase;
      }
      return next;
    });
  }, [healthById]);

  // ── Derivation ──
  const snapshot = board.data;
  const totalSlots = snapshot?.totalDevices ?? 0;
  const boardType = snapshot?.boardType ?? catalog?.[0]?.current_board ?? null;

  const devices = useMemo<ModelsDeployedDevices>(() => {
    const all = snapshot?.cards.flatMap((c) => c.devices) ?? [];
    return {
      all,
      used: all.filter((d) => d.status === "in_use" || d.status === "starting"),
      available: all.filter((d) => d.status === "idle" || d.status === "unknown"),
      unavailable: all.filter((d) => d.status === "resetting" || d.status === "error"),
      total: all.length,
    };
  }, [snapshot]);

  const result = useMemo(() => {
    const boardTypeArg = boardType ?? undefined;
    const slotsForFit = totalSlots || 4;

    // Occupancy as deviceFit expects it, including in-flight claims.
    const slots: DeviceSlotLike[] = devices.all.map((d) => ({
      slot_id: d.id,
      status:
        d.status === "idle" || d.status === "unknown" ? "available" : "occupied",
      model_name: d.deployment?.modelName,
    }));

    // Catalog lookup.
    const rawById = new Map<string, CatalogApiModel>();
    const rawByName = new Map<string, CatalogApiModel>();
    for (const m of catalog ?? []) {
      rawById.set(m.id, m);
      if (!rawByName.has(m.name.toLowerCase())) rawByName.set(m.name.toLowerCase(), m);
    }
    const resolveRaw = (id: string | null, name: string | null) =>
      (id ? rawById.get(id) : undefined) ??
      (name ? rawByName.get(name.toLowerCase()) : undefined) ??
      null;

    // Board deployments (device occupancy) by id.
    const boardDeps = snapshot
      ? [...snapshot.deployments, ...snapshot.unplacedDeployments]
      : [];
    const boardByDeploymentId = new Map<number, BoardDeployment>();
    const boardByJobId = new Map<string, BoardDeployment>();
    for (const b of boardDeps) {
      if (b.deploymentId != null) boardByDeploymentId.set(b.deploymentId, b);
      if (b.jobId) boardByJobId.set(b.jobId, b);
    }
    const cardOf = (id: number) =>
      devices.all.find((d) => d.id === id)?.cardIndex ?? null;

    type Draft = Omit<ModelDeployment, "model" | "stateLabel" | "phase" | "cardIndexes"> & {
      raw: CatalogApiModel | null;
    };
    const drafts: Draft[] = [];

    // 1. Containers (managed + external), excluding pending placeholders.
    const containers = canonical.filter((d) => !d.is_pending);
    const claimedContainers = new Set<string>();

    const containerDraft = (d: CanonicalDeployment): Draft => {
      const boardDep =
        d.deployment_id != null ? boardByDeploymentId.get(d.deployment_id) : undefined;
      const deviceIds = sortedUnique(
        boardDep?.deviceIds ??
          d.device_ids ??
          (d.device_id != null ? [d.device_id] : [])
      );
      const modelId = canonicalModelId(d);
      const modelName = canonicalModelName(d);
      const raw = resolveRaw(modelId, modelName);
      const derived = stateFromContainer(d, healthById[d.id], lastPhaseByContainer[d.id]);
      return {
        key: d.deployment_id != null ? `dep-${d.deployment_id}` : `ctr-${d.id}`,
        ...derived,
        source: d.source === "docker_only" ? "external" : "managed",
        modelId: raw?.id ?? modelId,
        modelName,
        raw,
        deviceIds,
        devicesKnown: deviceIds.length > 0,
        containerId: d.id,
        deploymentId: d.deployment_id ?? null,
        jobId: null,
        port: boardDep?.port ?? canonicalPort(d),
        startedAt: parseTime(d.deployed_at),
        stale: !!d.status_stale,
        dismissible: false,
        jobProgress: null,
        startupPhase: healthById[d.id]?.phase ?? null,
      };
    };

    // 2. Deploy jobs. An active job owns its container (if one exists yet) so the
    //    user sees one card that moves through download → deploy; a completed job
    //    hands over to its container's readiness state.
    const sameModel = (job: ActiveDeployment, d: CanonicalDeployment) => {
      const id = canonicalModelId(d);
      if (job.modelId && id) return job.modelId === id;
      return job.modelName.toLowerCase() === canonicalModelName(d).toLowerCase();
    };
    const findJobContainer = (job: ActiveDeployment) =>
      containers.find((d) => {
        if (d.source !== "managed" || claimedContainers.has(d.id) || !sameModel(job, d)) {
          return false;
        }
        const deployedAt = parseTime(d.deployed_at);
        return deployedAt == null || deployedAt >= job.startedAt - JOB_CONTAINER_SLACK_MS;
      });

    const jobModelKeys = new Set<string>();
    for (const job of jobs) {
      jobModelKeys.add((job.modelId || job.modelName).toLowerCase());
      const container = job.status === "failed" ? undefined : findJobContainer(job);
      if (container) claimedContainers.add(container.id);

      if (container && job.status === "completed") {
        drafts.push(containerDraft(container));
        continue;
      }

      const progress = progressByJob[job.jobId] ?? null;
      const derived = stateFromJob(job, progress, lastStageByJob[job.jobId]);
      const raw = resolveRaw(job.modelId || null, job.modelName);
      const fromContainer = container ? containerDraft(container) : null;
      const boardDep = boardByJobId.get(job.jobId);
      const deviceIds = sortedUnique(
        fromContainer?.devicesKnown
          ? fromContainer.deviceIds
          : boardDep?.deviceIds.length
            ? boardDep.deviceIds
            : job.deviceIds
      );
      drafts.push({
        key: `job-${job.jobId}`,
        ...derived,
        source: container ? "managed" : "pending",
        modelId: raw?.id ?? (job.modelId || null),
        modelName: job.modelName,
        raw,
        deviceIds,
        devicesKnown: deviceIds.length > 0,
        containerId: container?.id ?? null,
        deploymentId: container?.deployment_id ?? null,
        jobId: job.jobId,
        port: fromContainer?.port ?? null,
        startedAt: job.startedAt,
        stale: fromContainer?.stale ?? false,
        dismissible: job.status === "failed",
        jobProgress: progress,
        startupPhase: null,
      });
    }

    // 3. Remaining containers.
    for (const d of containers) {
      if (!claimedContainers.has(d.id)) drafts.push(containerDraft(d));
    }

    // 4. Pending placeholders no job tracks (e.g. dismissed in this tab, but the
    //    backend is still starting them).
    for (const d of canonical) {
      if (!d.is_pending || d.source !== "managed") continue;
      const modelId = canonicalModelId(d);
      const modelName = canonicalModelName(d);
      if (jobModelKeys.has((modelId || modelName).toLowerCase())) continue;
      const raw = resolveRaw(modelId, modelName);
      const deviceIds = sortedUnique(d.device_ids ?? (d.device_id != null ? [d.device_id] : []));
      drafts.push({
        key: d.deployment_id != null ? `dep-${d.deployment_id}` : `pending-${d.id}`,
        state: "deploying",
        message: null,
        progress: null,
        source: "pending",
        modelId: raw?.id ?? modelId,
        modelName,
        raw,
        deviceIds,
        devicesKnown: deviceIds.length > 0,
        containerId: null,
        deploymentId: d.deployment_id ?? null,
        jobId: null,
        port: null,
        startedAt: parseTime(d.deployed_at),
        stale: !!d.status_stale,
        dismissible: false,
        jobProgress: null,
        startupPhase: null,
      });
    }

    // 5. Devices held by something none of the above describes (external
    //    containers chip-status sees but the deployments endpoint doesn't).
    const coveredDevices = new Set(drafts.flatMap((d) => d.deviceIds));
    for (const b of snapshot?.deployments ?? []) {
      if (b.source !== "external" || b.deviceIds.some((id) => coveredDevices.has(id))) continue;
      drafts.push({
        key: `ext-${b.key}`,
        state: "active",
        message: null,
        progress: null,
        source: "external",
        modelId: null,
        modelName: b.modelName,
        raw: resolveRaw(null, b.modelName),
        deviceIds: b.deviceIds,
        devicesKnown: true,
        containerId: b.containerId,
        deploymentId: b.deploymentId,
        jobId: null,
        port: b.port,
        startedAt: null,
        stale: false,
        dismissible: false,
        jobProgress: null,
        startupPhase: null,
      });
    }

    // Build models, then attach deployments both ways.
    const modelsById = new Map<string, DeployableModel>();
    const models: DeployableModel[] = (catalog ?? []).map((raw) => {
      const placement = placementFor(raw, boardTypeArg, slotsForFit);
      const requiredDevices = minDevicesFor(raw, slotsForFit);
      const fits =
        devices.all.length > 0 &&
        autoPlacementFor(raw, placement, slots, slotsForFit) !== null;
      const incompatible = raw.is_compatible === false;
      const model: DeployableModel = {
        id: raw.id,
        name: raw.name,
        description: raw.description ?? null,
        tasks: [taskForModelType(raw.model_type)],
        modelType: raw.model_type,
        displayModelType: raw.display_model_type ?? null,
        requiredDevices,
        deviceOptions: deviceCountOptions(raw, boardTypeArg, slotsForFit),
        isCompatible: raw.is_compatible,
        compatibleBoards: raw.compatible_boards ?? [],
        status: raw.status ?? null,
        source: raw.source ?? "inference-server",
        author: raw.author ?? null,
        hfModelId: raw.hf_model_id ?? null,
        noPageReason: raw.no_page_reason ?? null,
        canDeploy: !incompatible && fits,
        deployBlockedReason: incompatible
          ? `Not supported on ${boardType ?? "this board"}`
          : fits
            ? null
            : devices.all.length === 0
              ? "No devices detected"
              : deployabilityReason(placement, requiredDevices, slots, slotsForFit) ??
                "Not enough free devices",
        deployments: [],
        raw,
      };
      modelsById.set(raw.id, model);
      return model;
    });

    const deployments: ModelDeployment[] = drafts
      .map(({ raw, ...d }) => {
        const model = raw ? (modelsById.get(raw.id) ?? null) : null;
        const cardIndexes = sortedUnique(
          d.deviceIds.map(cardOf).filter((c): c is number => c != null)
        );
        return {
          ...d,
          model,
          stateLabel: DEPLOYMENT_STATE_LABELS[d.state],
          phase: DEPLOYMENT_STATE_PHASE[d.state],
          cardIndexes,
        };
      })
      .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));

    for (const dep of deployments) dep.model?.deployments.push(dep);

    return { models, deployments };
  }, [
    boardType,
    totalSlots,
    devices,
    catalog,
    snapshot,
    canonical,
    jobs,
    progressByJob,
    healthById,
    lastStageByJob,
    lastPhaseByContainer,
  ]);

  // ── Actions ──
  const [refreshing, setRefreshing] = useState(false);
  const boardRefresh = board.refresh;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([boardRefresh(), fetchCatalog()]);
    } finally {
      setRefreshing(false);
    }
  }, [boardRefresh, fetchCatalog]);

  const dismissDeployment = useCallback(
    (key: string) => {
      const dep = result.deployments.find((d) => d.key === key);
      if (dep?.dismissible && dep.jobId) removeDeployment(dep.jobId);
    },
    [result.deployments, removeDeployment]
  );

  return {
    models: result.models,
    deployments: result.deployments,
    devices,
    boardType,
    loading: catalog === null || board.loading,
    refreshing: refreshing || board.refreshing,
    error: catalogError ?? board.error,
    refresh,
    dismissDeployment,
  };
}
