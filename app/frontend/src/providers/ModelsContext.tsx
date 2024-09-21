// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { fetchModels } from "../api/modelsDeployedApis";

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
}

const ModelsContext = createContext<ModelsContextType | undefined>(undefined);

export const ModelsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [models, setModels] = useState<Model[]>([]);

  const refreshModels = useCallback(async () => {
    try {
      const fetchedModels = await fetchModels();
      setModels(fetchedModels);
    } catch (error) {
      console.error("Error refreshing models:", error);
    }
  }, []);

  return (
    <ModelsContext.Provider value={{ models, setModels, refreshModels }}>
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
