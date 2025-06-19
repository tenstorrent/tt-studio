// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { AnimatedDeployButton } from "./magicui/AnimatedDeployButton";
import { useStepper } from "./ui/stepper";
import { Weight } from "./SelectionSteps";
import { StepperFormActions } from "./StepperFormActions";
import { useModels } from "../providers/ModelsContext";
import { useRefresh } from "../providers/RefreshContext";
import { Cpu, Sliders, AlertTriangle, ExternalLink } from "lucide-react";
import { checkCurrentlyDeployedModels } from "../api/modelsDeployedApis";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export function DeployModelStep({
  handleDeploy,
  selectedModel,
  selectedWeight,
  customWeight,
}: {
  selectedModel: string | null;
  selectedWeight: string | null;
  customWeight: Weight | null;
  handleDeploy: () => Promise<boolean>;
}) {
  const { nextStep } = useStepper();
  const { refreshModels } = useModels();
  const { triggerRefresh } = useRefresh();
  const navigate = useNavigate();
  const [modelName, setModelName] = useState<string | null>(null);
  const [deployedInfo, setDeployedInfo] = useState<{
    hasDeployedModels: boolean;
    count: number;
    modelNames: string[];
  }>({
    hasDeployedModels: false,
    count: 0,
    modelNames: [],
  });

  useEffect(() => {
    const fetchModelName = async () => {
      if (selectedModel) {
        try {
          const response = await axios.get(`/docker-api/get_containers/`);
          const models = response.data;
          const model = models.find((m: { id: string; name: string }) => m.id === selectedModel);
          if (model) {
            setModelName(model.name);
          }
        } catch (error) {
          console.error("Error fetching model name:", error);
        }
      }
    };

    fetchModelName();
  }, [selectedModel]);

  useEffect(() => {
    const checkDeployedModels = async () => {
      try {
        const info = await checkCurrentlyDeployedModels();
        setDeployedInfo(info);
      } catch (error) {
        console.error("Error checking deployed models:", error);
      }
    };

    checkDeployedModels();
  }, []);

  const deployButtonText = useMemo(() => {
    if (deployedInfo.hasDeployedModels) {
      return "Delete Existing Models First";
    }
    if (!selectedModel) return "Select a Model";
    if (!selectedWeight && !customWeight) return "Select a Weight";
    return "Deploy Model";
  }, [selectedModel, selectedWeight, customWeight, deployedInfo.hasDeployedModels]);

  const isDeployDisabled =
    !selectedModel || (!selectedWeight && !customWeight) || deployedInfo.hasDeployedModels;

  const onDeploy = useCallback(async () => {
    if (isDeployDisabled) return false;

    const deploySuccess = await handleDeploy();
    if (deploySuccess) {
      // Refresh the models context
      await refreshModels();

      // Trigger a global refresh
      triggerRefresh();
    }
    return deploySuccess;
  }, [handleDeploy, refreshModels, triggerRefresh, isDeployDisabled]);

  const onDeploymentComplete = useCallback(() => {
    setTimeout(() => {
      nextStep();
    }, 650); // Short delay before moving to the next step
  }, [nextStep]);

  const handleGoToDeployedModels = () => {
    navigate("/models-deployed");
  };

  // Show blocking message when models are deployed
  if (deployedInfo.hasDeployedModels) {
    return (
      <>
        <div className="flex flex-col items-center justify-center p-10 space-y-6">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
              Cannot Deploy New Model
            </h3>
            <p className="text-red-700 dark:text-red-300 mb-4">
              {deployedInfo.count} model
              {deployedInfo.count > 1 ? "s are" : " is"} currently deployed. You must delete
              existing models before deploying a new one.
            </p>
            <div className="space-y-2 mb-4">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Currently deployed:
              </p>
              <ul className="text-sm text-red-700 dark:text-red-300">
                {deployedInfo.modelNames.map((name, index) => (
                  <li key={index} className="truncate">
                    • {name}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              onClick={handleGoToDeployedModels}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Manage Deployed Models
            </Button>
          </div>

          {/* Show selected model info but grayed out */}
          {modelName && (
            <div className="mt-6 flex flex-col items-start justify-center space-y-4 opacity-50">
              <div className="flex items-center space-x-2">
                <Cpu className="text-TT-purple-accent" />
                <span className="text-sm text-gray-800 dark:text-gray-400">Selected Model:</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                  {modelName}
                </span>
              </div>
              {(selectedWeight || customWeight) && (
                <div className="flex items-center space-x-2">
                  <Sliders className="text-TT-purple-accent" />
                  <span className="text-sm text-gray-800 dark:text-gray-400">Selected Weight:</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                    {selectedWeight || (customWeight && customWeight.name)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <StepperFormActions removeDynamicSteps={() => {}} />
      </>
    );
  }

  return (
    <>
      <div
        className="flex flex-col items-center justify-center p-10 overflow-hidden"
        style={{ minHeight: "300px" }}
      >
        <AnimatedDeployButton
          initialText={<span>{deployButtonText}</span>}
          changeText={<span>Deploying Model...</span>}
          onDeploy={onDeploy}
          disabled={isDeployDisabled}
          onDeploymentComplete={onDeploymentComplete}
        />
        <div className="mt-6 flex flex-col items-start justify-center space-y-4">
          {modelName && (
            <div className="flex items-center space-x-2">
              <Cpu className="text-TT-purple-accent" />
              <span className="text-sm text-gray-800 dark:text-gray-400">Model:</span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {modelName}
              </span>
            </div>
          )}
          {(selectedWeight || customWeight) && (
            <div className="flex items-center space-x-2">
              <Sliders className="text-TT-purple-accent" />
              <span className="text-sm text-gray-800 dark:text-gray-400">Weight:</span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {selectedWeight || (customWeight && customWeight.name)}
              </span>
            </div>
          )}
        </div>
      </div>
      <StepperFormActions removeDynamicSteps={() => {}} />
    </>
  );
}
