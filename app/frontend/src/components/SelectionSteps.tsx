// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import axios from "axios";
import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Step, Stepper } from "./ui/stepper";
import CustomToaster, { customToast } from "./CustomToaster";
import StepperFooter from "./StepperFooter";
import { DeployModelStep } from "./DeployModelStep";
import { StepperFormActions } from "./StepperFormActions";
import { WeightForm } from "./WeightForm";
import { SecondStepForm } from "./SecondStepForm";
import { FirstStepForm } from "./FirstStepForm";
import { UseFormReturn } from "react-hook-form";

const dockerAPIURL = "/docker-api/";
const modelAPIURL = "/models-api/";
const deployUrl = `${dockerAPIURL}deploy/`;
export const getModelsUrl = `${dockerAPIURL}get_containers/`;
export const getWeightsUrl = (modelId: string) =>
  `${modelAPIURL}model_weights/?model_id=${modelId}`;

export interface SecondStepFormProps {
  addCustomStep: () => void;
  addFineTuneStep: () => void;
  removeDynamicSteps: () => void;
}

export interface Model {
  id: string;
  name: string;
}

export interface Weight {
  weights_id: string;
  name: string;
}

export default function StepperDemo() {
  const [steps, setSteps] = useState([
    { label: "Step 1", description: "Model Selection" },
    { label: "Step 2", description: "Model Weight Selection" },
    { label: "Final Step", description: "Deploy Model" },
  ]);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<string | null>(null);
  const [customWeight, setCustomWeight] = useState<Weight | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(false);

  const addCustomStep = () => {
    setSteps((prevSteps) => {
      const customStepIndex =
        prevSteps.findIndex((step) => step.label === "Step 2") + 1;
      const customStep = {
        label: "Custom Step",
        description: "Upload Custom Weights",
      };
      if (!prevSteps.some((step) => step.label === "Custom Step")) {
        return [
          ...prevSteps.slice(0, customStepIndex),
          customStep,
          ...prevSteps.slice(customStepIndex),
        ];
      }
      return prevSteps;
    });
  };

  const addFineTuneStep = () => {
    setSteps((prevSteps) => {
      const fineTuneStepIndex =
        prevSteps.findIndex((step) => step.label === "Step 2") + 1;
      const fineTuneStep = {
        label: "Fine-Tune Step",
        description: "Link to Fine Tuner",
      };
      if (!prevSteps.some((step) => step.label === "Fine-Tune Step")) {
        return [
          ...prevSteps.slice(0, fineTuneStepIndex),
          fineTuneStep,
          ...prevSteps.slice(fineTuneStepIndex),
        ];
      }
      return prevSteps;
    });
  };

  const removeDynamicSteps = () => {
    setSteps((prevSteps) =>
      prevSteps.filter(
        (step) =>
          step.label !== "Custom Step" && step.label !== "Fine-Tune Step",
      ),
    );
  };

  const handleDeploy = async (): Promise<boolean> => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 2500);

    const model_id = selectedModel || "0";
    const weights_id =
      selectedWeight === "Default Weights"
        ? ""
        : customWeight?.weights_id || selectedWeight;

    const payload = JSON.stringify({
      model_id,
      weights_id,
    });

    console.log("Deploying model with:", payload);
    try {
      const response = await axios.post(deployUrl, payload, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      console.log("Deployment response:", response);
      customToast.success("Model deployment started!");
      return true;
    } catch (error) {
      console.error("Error during deployment:", error);
      customToast.error("Deployment failed!");
      return false;
    }
  };

  return (
    <div className="flex flex-col gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 pt-10 py-6">
      <CustomToaster />
      <Card className="h-auto py-8 px-16 border-2">
        <Stepper
          variant="circle-alt"
          initialStep={0}
          steps={steps}
          state={loading ? "loading" : formError ? "error" : undefined}
        >
          {steps.map((stepProps) => {
            switch (stepProps.label) {
              case "Step 1":
                return (
                  <Step key={stepProps.label} {...stepProps} className="mb-8">
                    <FirstStepForm
                      setSelectedModel={setSelectedModel}
                      setFormError={setFormError}
                    />
                  </Step>
                );
              case "Step 2":
                return (
                  <Step key={stepProps.label} {...stepProps} className="mb-8">
                    <SecondStepForm
                      selectedModel={selectedModel}
                      setSelectedWeight={setSelectedWeight}
                      addCustomStep={addCustomStep}
                      addFineTuneStep={addFineTuneStep}
                      removeDynamicSteps={removeDynamicSteps}
                      setFormError={setFormError}
                    />
                  </Step>
                );
              case "Custom Step":
                return (
                  <Step key={stepProps.label} {...stepProps}>
                    <div className="py-8 px-16">
                      <WeightForm
                        selectedModel={selectedModel}
                        setCustomWeight={setCustomWeight}
                        setFormError={setFormError}
                      />
                    </div>
                  </Step>
                );
              case "Fine-Tune Step":
                return (
                  <Step key={stepProps.label} {...stepProps}>
                    <div className="flex flex-col items-center w-full justify-center p-10">
                      <Button
                        onClick={() =>
                          customToast.success("Link to Fine Tuner activated")
                        }
                      >
                        Link to Fine Tuner
                      </Button>
                    </div>
                    <StepperFormActions
                      form={{} as UseFormReturn<FormData, unknown>}
                      removeDynamicSteps={removeDynamicSteps}
                    />
                  </Step>
                );
              case "Final Step":
                return (
                  <Step key={stepProps.label} {...stepProps}>
                    <DeployModelStep
                      selectedModel={selectedModel}
                      selectedWeight={selectedWeight}
                      customWeight={customWeight}
                      handleDeploy={handleDeploy}
                    />
                  </Step>
                );
              default:
                return null;
            }
          })}
          <div className="py-12">
            <StepperFooter removeDynamicSteps={removeDynamicSteps} />
          </div>
        </Stepper>
      </Card>
    </div>
  );
}
