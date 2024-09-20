// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { AnimatedDeployButton } from "./magicui/AnimatedDeployButton";
import { useStepper } from "./ui/stepper";
import { Weight } from "./SelectionSteps";
import { StepperFormActions } from "./StepperFormActions";
import { useModels } from "../providers/ModelsContext";
import { useRefresh } from "../providers/RefreshContext";
import { Cpu, Sliders } from "lucide-react";
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
  const [modelName, setModelName] = useState<string | null>(null);

  useEffect(() => {
    const fetchModelName = async () => {
      if (selectedModel) {
        try {
          const response = await axios.get(`/docker-api/get_containers/`);
          const models = response.data;
          const model = models.find(
            (m: { id: string; name: string }) => m.id === selectedModel,
          );
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

  const deployButtonText = useMemo(() => {
    if (!selectedModel) return "Select a Model";
    if (!selectedWeight && !customWeight) return "Select a Weight";
    return "Deploy Model";
  }, [selectedModel, selectedWeight, customWeight]);

  const isDeployDisabled = !selectedModel || (!selectedWeight && !customWeight);

  const onDeploy = useCallback(async () => {
    if (isDeployDisabled) return;

    const deploySuccess = await handleDeploy();
    if (deploySuccess) {
      // Refresh the models context
      await refreshModels();

      // Trigger a global refresh
      triggerRefresh();

      setTimeout(() => {
        nextStep();
      }, 1200); // Timing matches the animation for a smooth transition
    }
  }, [handleDeploy, nextStep, refreshModels, triggerRefresh, isDeployDisabled]);

  return (
    <>
      <div className="flex flex-col items-center justify-center p-10">
        <AnimatedDeployButton
          initialText={<span>{deployButtonText}</span>}
          changeText={<span>Model Deployed!</span>}
          onDeploy={onDeploy}
          disabled={isDeployDisabled}
        />
        <div className="mt-6 flex flex-col items-start justify-center space-y-4">
          {modelName && (
            <div className="flex items-center space-x-2">
              <Cpu className="text-blue-400" />
              <span className="text-sm text-gray-800 dark:text-gray-400">
                Model:
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {modelName}
              </span>
            </div>
          )}
          {(selectedWeight || customWeight) && (
            <div className="flex items-center space-x-2">
              <Sliders className="text-blue-400" />
              <span className="text-sm text-gray-800 dark:text-gray-400">
                Weight:
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {selectedWeight || (customWeight && customWeight.name)}
              </span>
            </div>
          )}
        </div>
      </div>
      <StepperFormActions form={null} removeDynamicSteps={() => {}} />
    </>
  );
}
