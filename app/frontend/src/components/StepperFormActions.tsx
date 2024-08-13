"use client";
import { Button } from "./ui/button";
import { useStepper } from "./ui/stepper";

export function StepperFormActions({
  form,
  removeDynamicSteps,
  isSubmitting,
}: {
  form: any;
  removeDynamicSteps: () => void;
  isSubmitting?: boolean;
}) {
  const {
    prevStep,
    nextStep,
    resetSteps,
    isDisabledStep,
    hasCompletedAllSteps,
    isOptionalStep,
    activeStep,
    steps,
  } = useStepper();

  const customPrevStep = () => {
    const currentStepLabel = steps[activeStep]?.label;
    if (
      currentStepLabel === "Custom Step" ||
      currentStepLabel === "Fine-Tune Step"
    ) {
      removeDynamicSteps();
    }
    removeDynamicSteps();
    prevStep();
  };

  return (
    <div className="w-full flex justify-end gap-2">
      {hasCompletedAllSteps ? (
        <Button
          size="sm"
          onClick={() => {
            removeDynamicSteps();
            resetSteps();
          }}
        >
          Reset
        </Button>
      ) : (
        <>
          <Button
            disabled={isDisabledStep || activeStep === 0 || isSubmitting}
            onClick={customPrevStep}
            size="sm"
            variant="secondary"
          >
            Prev
          </Button>
          {activeStep < steps.length - 1 && (
            <Button
              size="sm"
              type={form ? "submit" : "button"}
              disabled={isSubmitting}
              onClick={!form ? nextStep : undefined}
            >
              {isOptionalStep ? "Skip" : "Next"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
