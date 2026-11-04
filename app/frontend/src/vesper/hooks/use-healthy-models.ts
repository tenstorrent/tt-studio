// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchHealthyModelsByType,
  type DeployedModelSummary,
} from "@/src/api/modelsDeployedApis";

/**
 * Deployed models of the given type(s) that are ready to serve requests, plus
 * the one currently picked. The model a demo was opened for (via the sidebar or
 * a deployment's "Open" button) is picked by default.
 */
export function useHealthyModels(modelType: string | string[]) {
  const location = useLocation();
  const preferred = (location.state as { containerID?: string } | null)
    ?.containerID;
  const query = useQuery<DeployedModelSummary[]>({
    queryKey: ["healthy-models", modelType],
    queryFn: () => fetchHealthyModelsByType(modelType),
    refetchInterval: 15_000,
  });
  const models = useMemo(() => query.data ?? [], [query.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // keep a valid pick: the current one, else the model the page was opened
  // for, else the first one ready
  useEffect(() => {
    if (models.length === 0) return;
    setSelectedId((current) => {
      if (current && models.some((m) => m.id === current)) return current;
      if (preferred && models.some((m) => m.id === preferred)) return preferred;
      return models[0].id;
    });
  }, [models, preferred]);

  // opened for a different model (e.g. from the sidebar): switch to it
  useEffect(() => {
    if (preferred) setSelectedId(preferred);
  }, [preferred]);

  return {
    models,
    isLoading: query.isPending,
    selected: models.find((m) => m.id === selectedId) ?? null,
    setSelectedId,
  };
}
