// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useCallback, useEffect } from "react";
import {
  fetchDeployments,
  fetchModels,
  type CanonicalDeployment,
} from "../api/modelsDeployedApis";
import { ModelsContext, type Model } from "../contexts/ModelsContext";

/** Format Docker port_bindings into the "host:port->container/proto" string the UI expects. */
function formatPortBindings(bindings: CanonicalDeployment["port_bindings"]): string {
  if (!bindings || Object.keys(bindings).length === 0) return "No ports";
  return Object.keys(bindings)
    .map((containerPort) => {
      const bindList = bindings[containerPort];
      if (!bindList || bindList.length === 0) return `${containerPort} (unbound)`;
      const b = bindList[0];
      return `${b.HostIp}:${b.HostPort}->${containerPort}`;
    })
    .join(", ");
}

function canonicalToModel(d: CanonicalDeployment): Model {
  return {
    id: d.id,
    name: d.deployment_model_name ?? d.model_impl?.model_name ?? d.name ?? "Unnamed",
    image: d.image_name ?? "Unknown image",
    status: d.status ?? "unknown",
    health: d.health ?? "unknown",
    ports: formatPortBindings(d.port_bindings),
    device_id: d.device_id ?? null,
    device_ids: d.device_ids ?? undefined,
    model_type: d.model_type ?? undefined,
    coding_agent_eligible: d.coding_agent_eligible ?? false,
  };
}

export const ModelsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [hasDeployedModels, setHasDeployedModels] = useState<boolean>(false);
  const [userStoppedModel, setUserStoppedModelState] = useState<boolean>(
    () => sessionStorage.getItem("userStoppedModel") === "true"
  );
  const [isDeleteInFlight, setIsDeleteInFlight] = useState<boolean>(false);

  const setUserStoppedModel = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setUserStoppedModelState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      sessionStorage.setItem("userStoppedModel", String(next));
      return next;
    });
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const deployments = await fetchDeployments();

      // Only fully-resolved managed deployments with a model_impl are visible. Pending starts and discovered-only Docker containers are hidden.
      const visible = deployments.filter(
        (d) =>
          d.source === "managed" &&
          !d.is_pending &&
          d.model_impl !== null,
      );

      if (visible.length > 0) {
        setUserStoppedModel(false);
        localStorage.setItem("hasEverDeployed", "true");
        setModels(visible.map(canonicalToModel));
        setHasDeployedModels(true);
      } else {
        setModels([]);
        setHasDeployedModels(false);
      }
    } catch (error) {
      console.error("Error refreshing models from /docker-api/deployments/:", error);
      // Conservative fallback: the legacy /docker-api/status/ endpoint is now
      // itself a shim over the same canonical computation, so this only
      // helps if the canonical endpoint is unroutable (e.g. older backend).
      try {
        const dockerModels = await fetchModels();
        setModels(dockerModels);
        setHasDeployedModels(false);
      } catch (dockerError) {
        console.error("Error fetching Docker models as fallback:", dockerError);
        setModels([]);
        setHasDeployedModels(false);
      }
    }
  }, [setUserStoppedModel]);

  // Keep deployed-model state fresh app-wide. UI that reacts to it (e.g. the
  // navbar hides the board reset button while a model is deployed) should
  // update on its own after a deploy or stop, without a manual refresh or a
  // container restart, so poll the canonical deployments endpoint on a light
  // interval in addition to the on-demand refreshes triggered elsewhere.
  useEffect(() => {
    refreshModels();
    const intervalId = setInterval(refreshModels, 5000);
    return () => clearInterval(intervalId);
  }, [refreshModels]);

  return (
    <ModelsContext.Provider
      value={{ models, setModels, refreshModels, hasDeployedModels, userStoppedModel, setUserStoppedModel, isDeleteInFlight, setIsDeleteInFlight }}
    >
      {children}
    </ModelsContext.Provider>
  );
};
