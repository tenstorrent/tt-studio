// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  fetchDeployments,
  fetchModels,
  canonicalToModel,
  isVisibleDeployment,
} from "../api/modelsDeployedApis";
import { ModelsContext, type Model } from "../contexts/ModelsContext";
import { useDeviceState } from "../hooks/useDeviceState";

export const ModelsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [hasDeployedModels, setHasDeployedModels] = useState<boolean>(false);
  const [userStoppedModel, setUserStoppedModelState] = useState<boolean>(
    () => sessionStorage.getItem("userStoppedModel") === "true"
  );
  const [isDeleteInFlight, setIsDeleteInFlight] = useState<boolean>(false);

  // Pause polling while a hardware reset is running.
  const { deviceState } = useDeviceState();
  const isResettingRef = useRef<boolean>(false);
  isResettingRef.current = deviceState?.state === "RESETTING";

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
      const visible = deployments.filter(isVisibleDeployment);

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
    const intervalId = setInterval(() => {
      if (isResettingRef.current) return; // paused during a reset
      refreshModels();
    }, 5000);
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
