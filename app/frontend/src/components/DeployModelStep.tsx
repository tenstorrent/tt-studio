// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import { useCallback, useMemo } from "react";
import { AnimatedDeployButton } from "./magicui/AnimatedDeployButton";
import { useStepper } from "./ui/stepper";
import { Weight } from "./SelectionSteps";
import { StepperFormActions } from "./StepperFormActions";
import { useModels } from "../providers/ModelsContext";
import { useRefresh } from "../providers/RefreshContext";

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
        {selectedModel && (
          <p className="mt-4 text-sm text-gray-600">
            Deploying model: {selectedModel}
          </p>
        )}
        {(selectedWeight || customWeight) && (
          <p className="mt-2 text-sm text-gray-600">
            Weight: {selectedWeight || (customWeight && customWeight.name)}
          </p>
        )}
      </div>
      <StepperFormActions form={null} removeDynamicSteps={() => {}} />
    </>
  );
}
