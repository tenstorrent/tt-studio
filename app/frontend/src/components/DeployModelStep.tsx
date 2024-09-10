// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";
import { AnimatedDeployButton } from "./magicui/AnimatedDeployButton";
import { useStepper } from "./ui/stepper";
import { Weight } from "./SelectionSteps";
import { StepperFormActions } from "./StepperFormActions";

export function DeployModelStep({
  handleDeploy,
}: {
  selectedModel: string | null;
  selectedWeight: string | null;
  customWeight: Weight | null;
  handleDeploy: () => Promise<boolean>;
}) {
  const { nextStep } = useStepper();

  const onDeploy = async () => {
    const deploySuccess = await handleDeploy();
    if (deploySuccess) {
      setTimeout(() => {
        nextStep();
      }, 1200); // Timing matches the animation for a smooth transition
    }
  };

  return (
    <>
      <div className="flex flex-col items-center justify-center p-10">
        <AnimatedDeployButton
          initialText={<span>Deploy Model</span>}
          changeText={<span>Model Deployed!</span>}
          onDeploy={onDeploy}
        />
      </div>
      <StepperFormActions form={null} removeDynamicSteps={() => {}} />
    </>
  );
}
