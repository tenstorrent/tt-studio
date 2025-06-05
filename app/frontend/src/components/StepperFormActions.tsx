// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC


import { Button } from "./ui/button";
import { useStepper } from "./ui/stepper";
import { UseFormReturn, FieldValues } from "react-hook-form";

type FormData = {
  weight: string;
};

export function StepperFormActions<
  TFieldValues extends FieldValues = FormData,
  TContext = unknown,
>({
  form,
  removeDynamicSteps,
  isSubmitting,
  onPrevStep,
  disableNext,
}: {
  form?: UseFormReturn<TFieldValues, TContext>;
  removeDynamicSteps: () => void;
  isSubmitting?: boolean;
  onPrevStep?: () => void;
  disableNext?: boolean;
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

  const handlePrevStep = () => {
    if (onPrevStep) {
      onPrevStep();
    } else {
      prevStep();
    }
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
            onClick={handlePrevStep}
            size="sm"
            variant="secondary"
          >
            Prev
          </Button>
          {activeStep < steps.length - 1 && (
            <Button
              size="sm"
              type={form ? "submit" : "button"}
              disabled={isSubmitting || disableNext}
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

