// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveDeploymentsContext } from "@/src/providers/ActiveDeploymentsContext";
import { useRefresh } from "@/src/hooks/useRefresh";
import { parseDeviceIds } from "@/src/utils/p300x2Placement";
import { getErrorMessage } from "@/src/utils/errors";
import { CHIP_STATUS_QUERY_KEY } from "@/src/vesper/hooks/use-chip-status";

export interface DeployRequest {
  /** Catalog id of the model, used to track the deploy */
  modelId: string;
  modelName: string;
  /** Model id to send when it differs from `modelId` (e.g. a serve profile) */
  deployModelId?: string;
  deviceId?: number | string;
  forceFullBoard?: boolean;
  hostWeightsDir?: string;
  /** Devices the deploy is expected to occupy, until the backend says otherwise */
  deviceIds: number[];
}

export interface DeployResult {
  jobId: string;
  deviceIds: number[];
}

interface ErrorBody {
  status?: string;
  message?: string;
  error?: string;
  error_code?: string;
  error_type?: string;
  hf_url?: string;
  conflicts?: { model?: string; slot?: number }[];
}

/** A readable reason for a refused deploy, across the shapes the backend sends. */
export function describeDeployError(err: unknown): string {
  if (!axios.isAxiosError(err) || !err.response?.data) {
    return getErrorMessage(err);
  }
  const data = err.response.data as ErrorBody;
  let message =
    data.message ||
    data.error ||
    `Deployment failed (HTTP ${err.response.status})`;
  if (data.error_code === "hf_access_denied" && data.hf_url) {
    message += ` Request access at ${data.hf_url}, then deploy again.`;
  }
  if (data.conflicts?.length) {
    message += ` Stop these first: ${data.conflicts
      .map((c) => `${c.model ?? "Unknown"} (device ${c.slot ?? "?"})`)
      .join(", ")}.`;
  }
  return message;
}

async function postDeploy(request: DeployRequest): Promise<DeployResult> {
  const payload: Record<string, unknown> = {
    model_id: request.deployModelId ?? request.modelId,
    weights_id: "",
    host_port: null,
  };
  if (request.forceFullBoard) payload.force_full_board = true;
  if (request.deviceId !== undefined) payload.device_id = request.deviceId;
  if (request.hostWeightsDir) payload.host_weights_dir = request.hostWeightsDir;

  const { data } = await axios.post("/docker-api/deploy/", payload, {
    headers: { "Content-Type": "application/json" },
  });
  if (data?.status === "error") {
    throw new Error(data.message || "Deployment failed");
  }
  if (!data?.job_id) {
    throw new Error(
      "Deployment started, but the backend returned no job to track."
    );
  }

  // the devices the deploy occupies: the full group when the backend reports
  // one, else whatever it allocated, else what was asked for
  let deviceIds = request.deviceIds;
  if (Array.isArray(data.device_ids) && data.device_ids.length > 0) {
    deviceIds = data.device_ids.map(Number).filter(Number.isFinite);
  } else if (typeof data.allocated_device_id === "number") {
    deviceIds = [data.allocated_device_id];
  } else if (typeof data.allocated_device_id === "string") {
    deviceIds = parseDeviceIds(data.allocated_device_id);
  }
  return { jobId: data.job_id, deviceIds };
}

/**
 * Start a deployment and hand it to the session-wide tracker, which then polls
 * its progress and reserves its devices.
 */
export function useDeployModel() {
  const queryClient = useQueryClient();
  const { addDeployment } = useActiveDeploymentsContext();
  const { triggerRefresh, triggerHardwareRefresh } = useRefresh();

  return useMutation({
    mutationFn: postDeploy,
    onSuccess: (result, request) => {
      addDeployment({
        jobId: result.jobId,
        modelId: request.modelId,
        modelName: request.modelName,
        deviceIds: result.deviceIds,
        startedAt: Date.now(),
      });
      triggerRefresh();
      void triggerHardwareRefresh();
      queryClient.invalidateQueries({ queryKey: CHIP_STATUS_QUERY_KEY });
    },
  });
}
