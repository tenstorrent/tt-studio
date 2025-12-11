// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from "axios";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { DockerStepForm } from "./DockerStepForm";

const dockerAPIURL = "/docker-api/";
const modelAPIURL = "/models-api/";
const catalogURL = `${dockerAPIURL}catalog/`;
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

interface ModelCatalogStatus {
  model_name: string;
  model_type: string;
  image_version: string;
  exists: boolean;
  size: string;
  status: string;
  disk_usage: {
    total_gb: number;
    used_gb: number;
    free_gb: number;
  } | null;
}

// Component to handle step adjustment when Docker step is removed
function StepAdjuster({
  steps,
  selectedModel,
  catalogStatus,
  baseSteps,
}: {
  steps: Array<{ label: string; description: string }>;
  selectedModel: string | null;
  catalogStatus: Record<string, ModelCatalogStatus>;
  baseSteps: Array<{ label: string; description: string }>;
}) {
  const { activeStep, setStep } = useStepper();
  const prevStepsLength = useRef<number>(steps.length);
  const prevImageAvailable = useRef<boolean>(false);

  useEffect(() => {
    // Check catalog status for image availability
    const imageAvailable = !!(
      selectedModel && catalogStatus[selectedModel]?.exists
    );

    // Check if Docker step was just removed (steps length decreased and image is now available)
    const dockerStepWasRemoved =
      !prevImageAvailable.current &&
      imageAvailable &&
      prevStepsLength.current > steps.length;

    // Find where Docker step would be in base steps (index 1)
    const dockerStepBaseIndex = baseSteps.findIndex(
      (step) => step.label === "Docker Step"
    );

    if (dockerStepWasRemoved && dockerStepBaseIndex !== -1) {
      // If user was on Docker step (index 1) or past it, adjust
      if (activeStep >= dockerStepBaseIndex) {
        // Docker step was at index 1
        // If we were on Docker step (index 1), move to Step 2 (which is now at index 1 after removal)
        // If we were past Docker step, we need to decrement by 1
        const newStep =
          activeStep === dockerStepBaseIndex
            ? dockerStepBaseIndex // Step 2 is now at the position Docker step was (index 1)
            : Math.max(0, activeStep - 1); // Decrement by 1 since Docker step was removed

        console.log(
          `Docker step removed - adjusting from step ${activeStep} to ${newStep}`
        );
        setStep(newStep);
      }
    }

    // Also handle case where user selects a model with available image while already past Docker step
    // This ensures step index is correct if catalog loads after user has progressed
    if (
      imageAvailable &&
      activeStep > dockerStepBaseIndex &&
      dockerStepBaseIndex !== -1
    ) {
      // Check if current step index is out of bounds due to Docker step removal
      // This is a safety check to ensure we're not on an invalid step
      if (activeStep >= steps.length) {
        console.log(
          `Step index ${activeStep} out of bounds, adjusting to ${steps.length - 1}`
        );
        setStep(Math.max(0, steps.length - 1));
      }
    }

    prevStepsLength.current = steps.length;
    prevImageAvailable.current = imageAvailable;
  }, [steps, selectedModel, catalogStatus, activeStep, setStep, baseSteps]);

  return null;
}

export default function StepperDemo() {
  // Remove unused destructured elements from useStepper
  // const { prevStep, nextStep, resetSteps, isDisabledStep, hasCompletedAllSteps, isOptionalStep, activeStep, steps: stepperSteps } = useStepper();

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoDeployModel = searchParams.get("auto-deploy");

  const baseSteps = [
    { label: "Step 1", description: "Model Selection" },
    { label: "Docker Step", description: "Pull Docker Image" },
    { label: "Step 2", description: "Model Weight Selection" },
    { label: "Final Step", description: "Deploy Model" },
  ];

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<
    Record<string, ModelCatalogStatus>
  >({});

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
  const [imageStatus, setImageStatus] = useState<{
    exists: boolean;
    size: string;
    status: string;
  } | null>(null);
  const [pullingImage, setPullingImage] = useState(false);

  // Track dynamic steps (Custom Step, Fine-Tune Step)
  const [hasCustomStep, setHasCustomStep] = useState(false);
  const [hasFineTuneStep, setHasFineTuneStep] = useState(false);

  // Filter steps based on Docker image availability and combine with dynamic steps
  const steps = useMemo(() => {
    // Check both catalog status and individual imageStatus for faster response
    const catalogExists = selectedModel && catalogStatus[selectedModel]?.exists;
    const imageStatusExists = selectedModel && imageStatus?.exists;
    const imageAvailable = catalogExists || imageStatusExists;

    console.log("🔍 Steps computation:", {
      selectedModel,
      catalogExists,
      imageStatusExists,
      imageAvailable,
      catalogStatus: catalogStatus[selectedModel || ""],
      imageStatus,
    });

    // Start with base steps, filtering out Docker Step if image is available
    let filteredSteps = imageAvailable
      ? baseSteps.filter((step) => step.label !== "Docker Step")
      : [...baseSteps];

    console.log(
      `📋 Steps filtered: ${filteredSteps.length} steps (Docker step ${imageAvailable ? "removed" : "included"})`
    );

    // Find the index where dynamic steps should be inserted (after Step 2)
    const step2Index = filteredSteps.findIndex(
      (step) => step.label === "Step 2"
    );
    const insertIndex =
      step2Index !== -1 ? step2Index + 1 : filteredSteps.length;

    // Add dynamic steps if they exist
    if (hasCustomStep) {
      const customStep = {
        label: "Custom Step",
        description: "Upload Custom Weights",
      };
      if (!filteredSteps.some((step) => step.label === "Custom Step")) {
        filteredSteps.splice(insertIndex, 0, customStep);
      }
    }

    if (hasFineTuneStep) {
      const fineTuneStep = {
        label: "Fine-Tune Step",
        description: "Link to Fine Tuner",
      };
      if (!filteredSteps.some((step) => step.label === "Fine-Tune Step")) {
        // Insert after Custom Step if it exists, otherwise after Step 2
        const insertPos = hasCustomStep
          ? filteredSteps.findIndex((step) => step.label === "Custom Step") + 1
          : insertIndex;
        filteredSteps.splice(insertPos, 0, fineTuneStep);
      }
    }

    return filteredSteps;
  }, [
    selectedModel,
    catalogStatus,
    imageStatus,
    hasCustomStep,
    hasFineTuneStep,
  ]);

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
              // Refresh catalog status to update steps (remove Docker step)
              try {
                const catalogResponse = await axios.get(catalogURL);
                if (catalogResponse.data.status === "success") {
                  setCatalogStatus(catalogResponse.data.models);
                }
              } catch (error) {
                console.error("Error refreshing catalog after pull:", error);
              }
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

  // Fetch catalog status and check image status immediately when selectedModel changes
  useEffect(() => {
    console.log("🚀 useEffect triggered for selectedModel:", selectedModel);

    const fetchCatalogAndImageStatus = async () => {
      if (!selectedModel) {
        console.log("❌ No selectedModel, clearing status");
        setCatalogStatus({});
        setImageStatus(null);
        return;
      }

      console.log(`🔍 Fetching status for model: ${selectedModel}`);
      try {
        // Fetch both catalog and individual image status in parallel for faster response
        const [catalogResponse, imageStatusResponse] = await Promise.all([
          axios.get(catalogURL).catch((err) => {
            console.error("Error fetching catalog:", err);
            return null;
          }),
          axios
            .get(`${dockerAPIURL}docker/image_status/${selectedModel}/`)
            .catch((err) => {
              console.error("Error fetching image status:", err);
              return null;
            }),
        ]);

        // Update catalog status
        if (
          catalogResponse &&
          catalogResponse.data &&
          catalogResponse.data.status === "success"
        ) {
          setCatalogStatus(catalogResponse.data.models);
          console.log(
            "Catalog status fetched:",
            catalogResponse.data.models[selectedModel]
          );
        }

        // Update individual image status
        if (imageStatusResponse && imageStatusResponse.data) {
          setImageStatus(imageStatusResponse.data);
          console.log("✅ Image status fetched:", imageStatusResponse.data);

          // If image exists, also update catalog status for that specific model
          // to ensure steps are updated immediately
          if (imageStatusResponse.data.exists) {
            console.log(
              `✅ Image exists for ${selectedModel}, updating catalog status to remove Docker step`
            );
            setCatalogStatus((prev) => {
              const updated = {
                ...prev,
                [selectedModel]: {
                  ...prev[selectedModel],
                  exists: true,
                  size: imageStatusResponse.data.size,
                  status: imageStatusResponse.data.status,
                  // Preserve other catalog fields if they exist
                  model_name: prev[selectedModel]?.model_name || selectedModel,
                  model_type: prev[selectedModel]?.model_type || "",
                  image_version: prev[selectedModel]?.image_version || "",
                  disk_usage: prev[selectedModel]?.disk_usage || null,
                },
              };
              console.log("📦 Updated catalog status:", updated[selectedModel]);
              return updated;
            });
          } else {
            console.log(
              `❌ Image does NOT exist for ${selectedModel}, Docker step will remain`
            );
          }
        }
      } catch (error) {
        console.error("Error fetching status:", error);
      }
    };

    fetchCatalogAndImageStatus();
  }, [selectedModel]);

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
          <StepAdjuster
            steps={steps}
            selectedModel={selectedModel}
            catalogStatus={catalogStatus}
            baseSteps={baseSteps}
          />
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
              {step.label === "Docker Step" && (
                <DockerStepForm
                  selectedModel={selectedModel}
                  imageStatus={imageStatus}
                  pullingImage={pullingImage}
                  pullImage={pullImage}
                  removeDynamicSteps={removeDynamicSteps}
                  disableNext={!imageStatus?.exists}
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
