"use client";
import { Button } from "./ui/button";
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
      nextStep();
    }
  };

  return (
    <>
      <div className="flex flex-col items-center justify-center p-10">
        <Button onClick={onDeploy}>Deploy Model</Button>
      </div>
      <StepperFormActions form={null} removeDynamicSteps={() => {}} />
    </>
  );
}
