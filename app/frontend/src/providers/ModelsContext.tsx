// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useCallback } from "react";
import {
  fetchModels,
  fetchDeployedModelsInfo,
} from "../api/modelsDeployedApis";
import { ModelsContext, type Model } from "../contexts/ModelsContext";

export const ModelsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [hasDeployedModels, setHasDeployedModels] = useState<boolean>(false);
  const [userStoppedModel, setUserStoppedModelState] = useState<boolean>(
    () => sessionStorage.getItem("userStoppedModel") === "true"
  );

  const setUserStoppedModel = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setUserStoppedModelState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      sessionStorage.setItem("userStoppedModel", String(next));
      return next;
    });
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      // Fetch deployed models info and Docker container info in parallel
      const [deployedModelsInfo, dockerModels] = await Promise.all([
        fetchDeployedModelsInfo(),
        fetchModels(),
      ]);

      if (deployedModelsInfo.length > 0) {
        setUserStoppedModel(false);
        localStorage.setItem("hasEverDeployed", "true");
        // Merge the deployed models info with Docker container info.
        // model_type from deployed API is required for correct navbar routing (e.g. Speech Recognition -> /speech-to-text).
        const mergedModels = deployedModelsInfo.map((deployedModel) => {
          // Find corresponding Docker container
          const dockerModel = dockerModels.find(
            (docker) =>
              docker.name.includes(deployedModel.modelName.toLowerCase()) ||
              docker.id === deployedModel.id
          );

          return {
            id: deployedModel.id,
            name: deployedModel.modelName,
            image: dockerModel?.image || "Unknown image",
            status: dockerModel?.status || "deployed",
            health: dockerModel?.health || "unknown",
            ports: dockerModel?.ports || "No ports",
            device_id: dockerModel?.device_id ?? null,
            device_ids: dockerModel?.device_ids,
            model_type: deployedModel.model_type,
          };
        });

        setModels(mergedModels);
        setHasDeployedModels(true);
      } else {
        // Docker-only fallback: no model_type available; navbar uses name/image-based type inference.
        const dockerModels = await fetchModels();
        setModels(dockerModels);
        setHasDeployedModels(false);
      }
    } catch (error) {
      console.error("Error refreshing models:", error);
      // Fallback to Docker API if deployed models API fails (Docker-only mode; no model_type).
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

  return (
    <ModelsContext.Provider
      value={{ models, setModels, refreshModels, hasDeployedModels, userStoppedModel, setUserStoppedModel }}
    >
      {children}
    </ModelsContext.Provider>
  );
};
