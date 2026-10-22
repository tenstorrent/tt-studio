// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useModels } from "@/src/hooks/useModels";
import { useRefresh } from "@/src/hooks/useRefresh";
import { useActiveDeploymentsContext } from "@/src/providers/ActiveDeploymentsContext";
import type {
  ActiveDeployment,
  DeploymentProgressData,
} from "@/src/hooks/useActiveDeployments";
import { compactPercent, transferDetailParts } from "@/src/lib/deployProgress";
import {
  deploySessionStart,
  restartDeploySession,
} from "@/src/lib/deploySession";
import type { Model } from "@/src/contexts/ModelsContext";
import type { CatalogModel, DeploymentItem } from "@/src/vesper/types";
import { useModelCatalog } from "./use-model-catalog";
import { useModelHealth, type ModelHealth } from "./use-model-health";
import {
  useDeploymentHistory,
  type DeploymentHistoryRecord,
} from "./use-deployment-history";

// Stages reported by `/docker-api/deploy/progress/` before a container exists.
const DOWNLOAD_STAGES = new Set([
  "starting",
  "initialization",
  "setup",
  "unknown",
  "not_found",
  "pulling_image",
  "model_preparation",
]);

const STAGE_LABELS: Record<string, string> = {
  starting: "Starting",
  initialization: "Initializing",
  setup: "Setting up environment",
  unknown: "Connecting to deployment service",
  not_found: "Reconnecting to deployment service",
  pulling_image: "Pulling Docker image",
  model_preparation: "Preparing deployment",
  image_ready: "Image ready",
  container_setup: "Starting container",
  container_started: "Container running",
  network_setup: "Connecting to network",
  finalizing: "Finalizing deployment",
  complete: "Complete",
};

function getStageLabel(progress: DeploymentProgressData | null | undefined) {
  if (!progress) return "Starting";
  if (progress.waiting_for_job_id) return "Waiting for another deployment";
  if (progress.stage === "model_preparation") {
    if (progress.weights_cached) return "Weights cached, preparing";
    if (progress.total_bytes) return "Downloading model weights";
  }
  return STAGE_LABELS[progress.stage] ?? progress.stage ?? "Starting";
}

// --- session tracking -------------------------------------------------------
// Containers seen alive in this tab. A deployment that was alive and then died
// is surfaced as an error card; the history of failures before that isn't.
const seenLiveContainerIds = new Set<string>();
let lastResetAllNonce: number | null = null;
let sessionStart = deploySessionStart();

// Error cards the user has already dealt with (removed or reset).
const DISMISSED_KEY = "vesper-dismissed-deployment-errors";
const dismissedListeners = new Set<() => void>();
let dismissedErrors: string[] = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
})();

function subscribeDismissed(listener: () => void) {
  dismissedListeners.add(listener);
  return () => dismissedListeners.delete(listener);
}

export function dismissDeploymentError(containerId: string) {
  if (dismissedErrors.includes(containerId)) return;
  dismissedErrors = [...dismissedErrors, containerId];
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedErrors));
  } catch {
    // storage unavailable: dismissal only lasts for this page load
  }
  dismissedListeners.forEach((listener) => listener());
}

const DEAD_STATUSES = new Set(["exited", "dead", "failed", "stopped"]);

function deviceIdsForModel(model: Model) {
  if (model.device_ids && model.device_ids.length > 0) return model.device_ids;
  if (model.device_id !== null && model.device_id !== undefined)
    return [model.device_id];
  return [];
}

/** Find the catalog entry for a deployed model, preferring a matching type. */
function matchCatalogModel(
  catalog: CatalogModel[] | undefined,
  name: string,
  modelType?: string | null
) {
  if (!catalog) return undefined;
  const byName = catalog.filter(
    (m) => m.name.toLowerCase() === name.toLowerCase()
  );
  return (
    byName.find(
      (m) =>
        !modelType || m.model_type.toLowerCase() === modelType.toLowerCase()
    ) ?? byName[0]
  );
}

function sameModel(job: ActiveDeployment, model: Model) {
  return job.modelName.toLowerCase() === model.name.toLowerCase();
}

function jobItem(
  job: ActiveDeployment,
  progress: DeploymentProgressData | undefined,
  catalogModel: CatalogModel | undefined
): DeploymentItem {
  const base: DeploymentItem = {
    key: job.jobId,
    state: "downloading",
    modelName: job.modelName,
    catalogModelId: job.modelId || catalogModel?.id,
    jobId: job.jobId,
    deviceIds: job.deviceIds,
    progress: null,
    modelType: catalogModel?.model_type,
    hfModelId: catalogModel?.hf_model_id,
    startedAt: job.startedAt,
  };

  if (job.status === "failed") {
    // the progress payload keeps the last stage the deploy reached
    const wasDownloading = !progress || DOWNLOAD_STAGES.has(progress.stage);
    return {
      ...base,
      state: wasDownloading ? "download-failed" : "deploy-failed",
      progress: 0,
      errorMessage:
        progress?.message ||
        (wasDownloading ? "The download failed." : "The deployment failed."),
    };
  }

  const percent =
    job.status === "completed"
      ? 99
      : compactPercent(progress ?? null, false, job.hadImagePull);
  const downloading =
    job.status !== "completed" &&
    (!progress || DOWNLOAD_STAGES.has(progress.stage));
  const transfer = transferDetailParts(progress ?? null);
  return {
    ...base,
    state: downloading ? "downloading" : "deploying",
    progress: percent,
    stageLabel: getStageLabel(progress),
    transfer: transfer.length > 0 ? transfer : undefined,
  };
}

function containerItem(
  model: Model,
  health: ModelHealth | undefined,
  job: ActiveDeployment | undefined,
  jobProgress: DeploymentProgressData | undefined,
  failedRecord: DeploymentHistoryRecord | undefined,
  historyRecord: DeploymentHistoryRecord | undefined,
  catalogModel: CatalogModel | undefined
): DeploymentItem {
  const base: DeploymentItem = {
    key: model.id,
    state: "deploying",
    modelName: model.name,
    catalogModelId: catalogModel?.id,
    containerId: model.id,
    jobId: job?.jobId,
    deviceIds: deviceIdsForModel(model),
    progress: null,
    modelType: model.model_type ?? catalogModel?.model_type,
    hfModelId: catalogModel?.hf_model_id,
    historyId: historyRecord?.id,
    startedAt: historyRecord
      ? Date.parse(historyRecord.deployed_at)
      : undefined,
  };

  if (failedRecord) {
    return {
      ...base,
      state: "error",
      errorMessage:
        failedRecord.failure_message ?? "The container stopped unexpectedly.",
    };
  }
  if (model.disconnected) {
    return {
      ...base,
      state: "error",
      errorMessage:
        "The container is no longer attached to the TT-Studio network, so it can't be reached.",
    };
  }
  if (job && job.status === "active") {
    const merged = jobItem(job, jobProgress, catalogModel);
    return {
      ...base,
      state: "deploying",
      progress: merged.progress,
      stageLabel: merged.stageLabel,
    };
  }
  if (health?.status === "healthy") {
    return { ...base, state: "active" };
  }
  const phase = health?.phase;
  const transfer =
    phase?.downloaded_bytes && phase.total_bytes
      ? transferDetailParts({
          status: "running",
          stage: "model_preparation",
          progress: phase.progress,
          message: phase.message,
          downloaded_bytes: phase.downloaded_bytes,
          total_bytes: phase.total_bytes,
          speed_bps: phase.speed_bps ?? null,
          eta_seconds: phase.eta_seconds ?? null,
        })
      : [];
  return {
    ...base,
    state: "deploying",
    progress: phase
      ? Math.max(0, Math.min(100, Math.round(phase.progress)))
      : null,
    stageLabel: phase?.phase_label ?? "Warming up",
    transfer: transfer.length > 0 ? transfer : undefined,
  };
}

/**
 * Every deployment TT-Studio knows about in this session, in one list: deploys
 * still downloading (no container yet), containers warming up, active models,
 * and deployments that failed or died. This is the single source of truth for
 * the deployments panel, the sidebar demo links, and the hardware page.
 */
export function useDeployments() {
  const { models, refreshModels } = useModels();
  const { resetAllNonce } = useRefresh();
  const {
    deployments: jobs,
    progressByJob,
    removeDeployment,
  } = useActiveDeploymentsContext();
  const catalog = useModelCatalog();
  // only used to spot containers that died, so it needn't poll as often as
  // the history page does
  const history = useDeploymentHistory({ refetchInterval: 15_000 });
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    () => dismissedErrors
  );

  // A full board reset forgets the containers that died this session.
  if (lastResetAllNonce === null) {
    lastResetAllNonce = resetAllNonce;
  } else if (resetAllNonce !== lastResetAllNonce) {
    lastResetAllNonce = resetAllNonce;
    seenLiveContainerIds.clear();
    sessionStart = restartDeploySession();
  }

  const containerIds = useMemo(() => models.map((m) => m.id), [models]);
  const healthById = useModelHealth(containerIds);

  const items = useMemo(() => {
    const liveIds = new Set(containerIds);
    liveIds.forEach((id) => seenLiveContainerIds.add(id));

    const startedThisSession = (record: DeploymentHistoryRecord) =>
      Date.parse(record.deployed_at) >= sessionStart;

    // only the newest record per container describes its current state
    const latestByContainer = new Map<string, DeploymentHistoryRecord>();
    for (const record of history.data?.deployments ?? []) {
      if (!record.container_id || record.container_id.startsWith("pending_"))
        continue;
      const previous = latestByContainer.get(record.container_id);
      if (!previous || record.deployed_at >= previous.deployed_at) {
        latestByContainer.set(record.container_id, record);
      }
    }

    const failedById = new Map<string, DeploymentHistoryRecord>();
    for (const [id, record] of latestByContainer) {
      if (record.stopped_by_user) continue;
      const seen = seenLiveContainerIds.has(id) || liveIds.has(id);
      const looksDead = seen
        ? record.stopped_at !== null ||
          DEAD_STATUSES.has(record.status) ||
          !liveIds.has(id)
        : startedThisSession(record) &&
          (record.status === "exited" || record.status === "dead");
      if (looksDead) failedById.set(id, record);
    }

    const result: DeploymentItem[] = [];
    const consumedJobs = new Set<string>();

    for (const model of models) {
      const job = jobs.find(
        (j) =>
          j.status !== "failed" &&
          !consumedJobs.has(j.jobId) &&
          sameModel(j, model)
      );
      if (job) consumedJobs.add(job.jobId);
      const catalogModel = matchCatalogModel(
        catalog.data,
        model.name,
        model.model_type
      );
      result.push(
        containerItem(
          model,
          healthById[model.id],
          job,
          job ? progressByJob[job.jobId] : undefined,
          failedById.get(model.id),
          latestByContainer.get(model.id),
          catalogModel
        )
      );
    }

    // containers that died after being seen alive and have since been removed
    for (const [id, record] of failedById) {
      if (liveIds.has(id) || dismissed.includes(id)) continue;
      if (!seenLiveContainerIds.has(id) && !startedThisSession(record))
        continue;
      const catalogModel = matchCatalogModel(catalog.data, record.model_name);
      result.push({
        key: id,
        state: "error",
        modelName: record.model_name,
        catalogModelId: catalogModel?.id,
        containerId: id,
        deviceIds:
          record.device_id !== null && record.device_id !== undefined
            ? [record.device_id]
            : [],
        progress: null,
        modelType: catalogModel?.model_type,
        hfModelId: catalogModel?.hf_model_id,
        historyId: record.id,
        errorMessage:
          record.failure_message ?? "The container stopped unexpectedly.",
        startedAt: Date.parse(record.deployed_at),
        dead: true,
      });
    }

    // deploys that don't have a container yet, or failed before getting one
    for (const job of jobs) {
      if (consumedJobs.has(job.jobId)) continue;
      // a completed job's container shows up in the models list shortly
      if (job.status === "completed" && models.some((m) => sameModel(job, m)))
        continue;
      const catalogModel =
        catalog.data?.find((m) => m.id === job.modelId) ??
        matchCatalogModel(catalog.data, job.modelName);
      result.push(jobItem(job, progressByJob[job.jobId], catalogModel));
    }

    // newest first
    return result.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }, [
    containerIds,
    models,
    jobs,
    progressByJob,
    healthById,
    history.data,
    catalog.data,
    dismissed,
  ]);

  /** Drop a failed deploy or a dead container's card. */
  const dismiss = useCallback(
    (item: DeploymentItem) => {
      if (item.jobId && !item.containerId) removeDeployment(item.jobId);
      if (item.containerId) dismissDeploymentError(item.containerId);
    },
    [removeDeployment]
  );

  return {
    items,
    isLoading: catalog.isPending,
    refresh: refreshModels,
    dismiss,
  };
}
