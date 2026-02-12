// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  getModelConnection,
  saveModelConnection,
  clearModelConnection,
  type ModelPageType,
} from "../lib/modelPersistence";
import type { Model } from "../contexts/ModelsContext";

interface UseModelConnectionReturn {
  modelID: string | null;
  modelName: string | null;
  setModelID: (id: string | null) => void;
  setModelName: (name: string | null) => void;
  setModelConnection: (containerID: string, modelName: string) => void;
  clearConnection: () => void;
}

export function useModelConnection(
  pageType: ModelPageType,
  deployedModels: Model[]
): UseModelConnectionReturn {
  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);

  // Initialize model connection on mount
  useEffect(() => {
    // Priority 1: Check location.state (fresh navigation)
    if (location.state?.containerID && location.state?.modelName) {
      const id = location.state.containerID;
      const name = location.state.modelName;
      setModelID(id);
      setModelName(name);
      saveModelConnection(pageType, { containerID: id, modelName: name });
      return;
    }

    // Priority 2: Check localStorage (persisted connection)
    const persisted = getModelConnection(pageType);
    if (persisted) {
      setModelID(persisted.containerID);
      setModelName(persisted.modelName);
      return;
    }

    // Priority 3: Auto-select first available model
    if (deployedModels.length > 0) {
      const firstModel = deployedModels[0];
      setModelID(firstModel.id);
      setModelName(firstModel.name);
      saveModelConnection(pageType, {
        containerID: firstModel.id,
        modelName: firstModel.name,
      });
    }
  }, [location.state, deployedModels, pageType]);

  const setConnection = (containerID: string, modelName: string) => {
    setModelID(containerID);
    setModelName(modelName);
    saveModelConnection(pageType, { containerID, modelName });
  };

  const clearConnection = () => {
    setModelID(null);
    setModelName(null);
    clearModelConnection(pageType);
  };

  return {
    modelID,
    modelName,
    setModelID,
    setModelName,
    setModelConnection: setConnection,
    clearConnection,
  };
}
