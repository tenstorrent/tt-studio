// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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

  const refreshModels = useCallback(async () => {
    try {
      // Fetch deployed models info and Docker container info in parallel
      const [deployedModelsInfo, dockerModels] = await Promise.all([
        fetchDeployedModelsInfo(),
        fetchModels(),
      ]);

      if (deployedModelsInfo.length > 0) {
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
  }, []);

  return (
    <ModelsContext.Provider
      value={{ models, setModels, refreshModels, hasDeployedModels }}
    >
      {children}
    </ModelsContext.Provider>
  );
};
