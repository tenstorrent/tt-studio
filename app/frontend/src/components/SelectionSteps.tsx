// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import axios from "axios";
import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Step, Stepper, useStepper } from "./ui/stepper";
import CustomToaster, { customToast } from "./CustomToaster";
import StepperFooter from "./StepperFooter";
import { DeployModelStep } from "./DeployModelStep";
import { StepperFormActions } from "./StepperFormActions";
import { WeightForm } from "./WeightForm";
import { SecondStepForm } from "./SecondStepForm";
import { FirstStepForm } from "./FirstStepForm";
import { UseFormReturn } from "react-hook-form";
import { DockerStepForm } from "./DockerStepForm";

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
  is_compatible: boolean | null; // null means unknown compatibility
  compatible_boards: string[]; // List of boards this model can run on
  model_type: string; // Type of model (e.g., CHAT, IMAGE_GENERATION, etc.)
  current_board: string; // The detected board type
}

export interface Weight {
  weights_id: string;
  name: string;
}

export default function StepperDemo() {
  // Remove unused destructured elements from useStepper
  // const { prevStep, nextStep, resetSteps, isDisabledStep, hasCompletedAllSteps, isOptionalStep, activeStep, steps: stepperSteps } = useStepper();

  const [steps, setSteps] = useState([
    { label: "Step 1", description: "Model Selection" },
    { label: "Docker Step", description: "Pull Docker Image" },
    { label: "Step 2", description: "Model Weight Selection" },
    { label: "Final Step", description: "Deploy Model" },
  ]);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<string | null>(null);
  const [customWeight, setCustomWeight] = useState<Weight | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(false);
  const [imageStatus, setImageStatus] = useState<{
    exists: boolean;
    size: string;
    status: string;
  } | null>(null);
  const [pullingImage, setPullingImage] = useState(false);

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
          step.label !== "Custom Step" && step.label !== "Fine-Tune Step"
      )
    );
  };

  const checkImageStatus = async (modelId: string) => {
    try {
      const response = await axios.get(
        `${dockerAPIURL}docker/image_status/${modelId}/`
      );
      console.log("Image status response:", response.data);
      setImageStatus(response.data);
    } catch (error) {
      console.error("Error checking image status:", error);
      customToast.error("Failed to check image status");
    }
  };

  const pullImage = async (modelId: string) => {
    setPullingImage(true);
    try {
      const response = await axios.post(
        `${dockerAPIURL}docker/pull_image/`,
        { model_id: modelId },
        {
          headers: {
            Accept: "text/event-stream",
          },
          responseType: "text",
        }
      );

      // Parse the SSE response manually
      const lines = response.data.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            console.log("Pull image response:", data);
            if (data.status === "success") {
              customToast.success("Image pulled successfully!");
              await checkImageStatus(modelId);
              setPullingImage(false);
              return;
            } else if (data.status === "error") {
              customToast.error(`Pull failed: ${data.message}`);
              setPullingImage(false);
              return;
            }
          } catch (parseError) {
            console.warn("Failed to parse SSE data:", line);
          }
        }
      }
    } catch (error) {
      console.error("Error pulling image:", error);
      customToast.error("Failed to pull image");
    } finally {
      setPullingImage(false);
    }
  };

  useEffect(() => {
    if (selectedModel) {
      checkImageStatus(selectedModel);
    }
  }, [selectedModel]);

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
          {steps.map((step, idx) => (
            <Step
              key={step.label}
              label={step.label}
              description={step.description}
              className="mb-8"
            >
              {step.label === "Step 1" && (
                <FirstStepForm
                  setSelectedModel={setSelectedModel}
                  setFormError={setFormError}
                />
              )}
              {step.label === "Docker Step" && (
                <DockerStepForm
                  selectedModel={selectedModel}
                  imageStatus={imageStatus}
                  pullingImage={pullingImage}
                  pullImage={pullImage}
                  removeDynamicSteps={removeDynamicSteps}
                  disableNext={!imageStatus?.exists}
                />
              )}
              {step.label === "Step 2" && (
                <SecondStepForm
                  selectedModel={selectedModel}
                  setSelectedWeight={setSelectedWeight}
                  addCustomStep={addCustomStep}
                  addFineTuneStep={addFineTuneStep}
                  removeDynamicSteps={removeDynamicSteps}
                  setFormError={setFormError}
                />
              )}
              {step.label === "Custom Step" && (
                <div className="py-8 px-16">
                  <WeightForm
                    selectedModel={selectedModel}
                    setCustomWeight={setCustomWeight}
                    setFormError={setFormError}
                  />
                </div>
              )}
              {step.label === "Fine-Tune Step" && (
                <>
                  <div className="flex flex-col items-center w-full justify-center p-10">
                    <Button
                      onClick={() =>
                        customToast.success("Link to Fine Tuner activated")
                      }
                    >
                      Link to Fine Tuner
                    </Button>
                  </div>
                  <StepperFormActions removeDynamicSteps={removeDynamicSteps} />
                </>
              )}
              {step.label === "Final Step" && (
                <DeployModelStep
                  selectedModel={selectedModel}
                  selectedWeight={selectedWeight}
                  customWeight={customWeight}
                  handleDeploy={handleDeploy}
                />
              )}
            </Step>
          ))}
          <div className="py-12">
            <StepperFooter removeDynamicSteps={removeDynamicSteps} />
          </div>
        </Stepper>
      </Card>
    </div>
  );
}
