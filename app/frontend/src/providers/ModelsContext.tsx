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
        // Merge the deployed models info with Docker container info
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
          };
        });

        setModels(mergedModels);
        setHasDeployedModels(true);
      } else {
        // If no deployed models, just use Docker API as fallback
        const dockerModels = await fetchModels();
        setModels(dockerModels);
        setHasDeployedModels(false);
      }
    } catch (error) {
      console.error("Error refreshing models:", error);
      // Fallback to Docker API if deployed models API fails
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
