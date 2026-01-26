// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from "axios";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ElevatedCard from "./ui/elevated-card";
import { Button } from "./ui/button";
import { Step, Stepper, useStepper } from "./ui/stepper";
import CustomToaster, { customToast } from "./CustomToaster";
import StepperFooter from "./StepperFooter";
import { DeployModelStep } from "./DeployModelStep";
import { StepperFormActions } from "./StepperFormActions";
import { WeightForm } from "./WeightForm";
import { SecondStepForm } from "./SecondStepForm";
import { FirstStepForm } from "./FirstStepForm";
// import { UseFormReturn } from "react-hook-form";

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

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoDeployModel = searchParams.get("auto-deploy");

  const baseSteps = [
    { label: "Step 1", description: "Model Selection" },
    { label: "Step 2", description: "Model Weight Selection" },
    { label: "Final Step", description: "Deploy Model" },
  ];

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<string | null>(null);

  // Log when selectedModel changes
  useEffect(() => {
    console.log("🎯 selectedModel changed to:", selectedModel);
  }, [selectedModel]);

  // Log when selectedWeight changes
  useEffect(() => {
    console.log("🎯 selectedWeight changed to:", selectedWeight);
  }, [selectedWeight]);
  const [customWeight, setCustomWeight] = useState<Weight | null>(null);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(false);
  const [isAutoDeploying, setIsAutoDeploying] = useState(false);

  // Track dynamic steps (Custom Step, Fine-Tune Step)
  const [hasCustomStep, setHasCustomStep] = useState(false);
  const [hasFineTuneStep, setHasFineTuneStep] = useState(false);

  // Combine base steps with dynamic steps
  const steps = useMemo(() => {
    let allSteps = [...baseSteps];

    // Find the index where dynamic steps should be inserted (after Step 2)
    const step2Index = allSteps.findIndex((step) => step.label === "Step 2");
    const insertIndex = step2Index !== -1 ? step2Index + 1 : allSteps.length;

    // Add dynamic steps if they exist
    if (hasCustomStep) {
      const customStep = {
        label: "Custom Step",
        description: "Upload Custom Weights",
      };
      if (!allSteps.some((step) => step.label === "Custom Step")) {
        allSteps.splice(insertIndex, 0, customStep);
      }
    }

    if (hasFineTuneStep) {
      const fineTuneStep = {
        label: "Fine-Tune Step",
        description: "Link to Fine Tuner",
      };
      if (!allSteps.some((step) => step.label === "Fine-Tune Step")) {
        // Insert after Custom Step if it exists, otherwise after Step 2
        const insertPos = hasCustomStep
          ? allSteps.findIndex((step) => step.label === "Custom Step") + 1
          : insertIndex;
        allSteps.splice(insertPos, 0, fineTuneStep);
      }
    }

    return allSteps;
  }, [hasCustomStep, hasFineTuneStep]);

  const addCustomStep = () => {
    setHasCustomStep(true);
  };

  const addFineTuneStep = () => {
    setHasFineTuneStep(true);
  };

  const removeDynamicSteps = useCallback(() => {
    setHasCustomStep(false);
    setHasFineTuneStep(false);
  }, []);

  // Direct auto-deploy function
  const performAutoDeploy = async (modelName: string) => {
    try {
      console.log("🚀 Starting auto-deployment for model:", modelName);

      // Find the model ID by name
      const response = await axios.get("/docker-api/get_containers/");
      const models = response.data;
      const model = models.find(
        (m: { id: string; name: string }) =>
          m.name.toLowerCase().includes(modelName.toLowerCase()) ||
          m.name === modelName
      );

      if (!model) {
        customToast.error(`Auto-deploy model "${modelName}" not found`);
        console.error("Model not found:", modelName);
        return;
      }

      console.log("Found model for auto-deploy:", model);

      // Deploy with default weights
      const deployPayload = {
        model_id: model.id,
        weights_id: "", // Empty string for default weights
      };

      console.log("Auto-deploy payload:", deployPayload);

      const deployResponse = await axios.post(
        "/docker-api/deploy/",
        deployPayload,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log("Auto-deploy response:", deployResponse);
      customToast.success(`Model "${modelName}" deployment started!`);

      // Navigate to deployed models page after short delay
      setTimeout(() => {
        navigate("/models-deployed");
      }, 1500);
    } catch (error) {
      console.error("Auto-deployment failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      customToast.error(`Auto-deployment failed: ${errorMessage}`);
    }
  };

  // Auto-deploy detection effect
  useEffect(() => {
    if (autoDeployModel) {
      setIsAutoDeploying(true);
      customToast.info(`🤖 Auto-deploying model: ${autoDeployModel}`);
      console.log("Auto-deploy mode detected for model:", autoDeployModel);

      // Perform auto-deploy directly
      performAutoDeploy(autoDeployModel);
    }
  }, [autoDeployModel]);

  const handleDeploy = async (): Promise<{
    success: boolean;
    job_id?: string;
  }> => {
    console.log("handleDeploy called with:", {
      selectedModel,
      selectedWeight,
      customWeight,
      isAutoDeploying,
    });

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

    console.log("Deployment payload:", payload);
    console.log("Deployment URL:", deployUrl);

    try {
      const response = await axios.post(deployUrl, payload, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log("Deployment response:", response);

      // Check if the response indicates an error
      if (response.data?.status === "error") {
        const errorMessage = response.data?.message || "Deployment failed";
        const jobId = response.data?.job_id || null;
        console.error("Deployment error:", errorMessage);
        console.log("Error job_id:", jobId);
        customToast.error(`Deployment failed: ${errorMessage}`);
        return { success: false, job_id: jobId };
      }

      customToast.success("Model deployment started!");

      return {
        success: true,
        job_id: response.data?.job_id,
      };
    } catch (error) {
      console.error("Error during deployment:", error);
      // Extract error message and job_id from response if available
      const errorMessage =
        axios.isAxiosError(error) && error.response?.data?.message
          ? error.response.data.message
          : "Deployment failed!";
      const jobId =
        axios.isAxiosError(error) && error.response?.data?.job_id
          ? error.response.data.job_id
          : null;
      console.log("Error job_id from catch:", jobId);
      customToast.error(`Deployment failed: ${errorMessage}`);
      return { success: false, job_id: jobId };
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
      <CustomToaster />
      <ElevatedCard
        accent="neutral"
        depth="lg"
        hover
        className="h-auto py-4 px-8 md:px-12 lg:px-16"
      >
        <Stepper
          variant="circle-alt"
          initialStep={0}
          steps={steps}
          state={loading ? "loading" : formError ? "error" : undefined}
        >
          {steps.map((step, _idx) => (
            <Step
              key={step.label}
              label={step.label}
              description={step.description}
              className="mb-4"
            >
              {step.label === "Step 1" && (
                <FirstStepForm
                  setSelectedModel={(modelId: string) => {
                    console.log("🔄 setSelectedModel called with:", modelId);
                    setSelectedModel(modelId);
                  }}
                  setFormError={setFormError}
                  autoDeployModel={autoDeployModel}
                  isAutoDeploying={isAutoDeploying}
                />
              )}
              {step.label === "Step 2" && (
                <SecondStepForm
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
      </ElevatedCard>
    </div>
  );
}
