// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useQuery } from "@tanstack/react-query";

/** A record from `/docker-api/deployment-history/` */
export interface DeploymentHistoryRecord {
  id: number;
  container_id: string;
  container_name: string;
  model_name: string;
  device: string;
  device_id?: number | null;
  deployed_at: string;
  stopped_at: string | null;
  status: string;
  stopped_by_user: boolean;
  port: number | null;
  workflow_log_path: string | null;
  failure_reason: string | null;
  failure_message: string | null;
  hf_url: string | null;
}

interface DeploymentHistoryResponse {
  status: string;
  deployments: DeploymentHistoryRecord[];
  count: number;
}

export const DEPLOYMENT_HISTORY_QUERY_KEY = ["deploymentHistory"];

async function fetchDeploymentHistory() {
  const { data } = await axios.get<DeploymentHistoryResponse>(
    "/docker-api/deployment-history/"
  );
  return data;
}

/** Every deployment ever started on this machine, newest first. */
export function useDeploymentHistory({
  refetchInterval = 5_000,
}: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: DEPLOYMENT_HISTORY_QUERY_KEY,
    queryFn: fetchDeploymentHistory,
    refetchInterval,
    refetchOnWindowFocus: true,
  });
}

/** Whether a history record describes a container that died on its own. */
export function diedUnexpectedly(record: DeploymentHistoryRecord) {
  const isHfFailure =
    record.failure_reason === "hf_auth" ||
    record.failure_reason === "hf_model_not_found";
  return (
    !record.stopped_by_user &&
    !isHfFailure &&
    (record.status === "exited" || record.status === "dead")
  );
}
