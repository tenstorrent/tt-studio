// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import {
  fetchModels,
  fetchDeployedModelsInfo,
} from "../api/modelsDeployedApis";

export interface Model {
  id: string;
  name: string;
  image: string;
  status: string;
  health: string;
  ports: string;
}

interface ModelsContextType {
  models: Model[];
  setModels: React.Dispatch<React.SetStateAction<Model[]>>;
  refreshModels: () => Promise<void>;
  hasDeployedModels: boolean;
}

const ModelsContext = createContext<ModelsContextType | undefined>(undefined);

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

export const useModels = () => {
  const context = useContext(ModelsContext);
  if (context === undefined) {
    throw new Error("useModels must be used within a ModelsProvider");
  }
  return context;
};
