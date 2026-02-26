// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ElevatedCard from "./ui/elevated-card";
import { Step, Stepper } from "./ui/stepper";
import { customToast } from "./CustomToaster";
import StepperFooter from "./StepperFooter";
import { DeployModelStep } from "./DeployModelStep";
import { FirstStepForm } from "./FirstStepForm";
import { ChipConfigStep } from "./ChipConfigStep";

const dockerAPIURL = "/docker-api/";
const deployUrl = `${dockerAPIURL}deploy/`;
export const getModelsUrl = `${dockerAPIURL}get_containers/`;

export interface Model {
  id: string;
  name: string;
  is_compatible: boolean | null; // null means unknown compatibility
  compatible_boards: string[]; // List of boards this model can run on
  model_type: string; // Type of model (e.g., CHAT, IMAGE_GENERATION, etc.)
  current_board: string; // The detected board type
  status?: "EXPERIMENTAL" | "FUNCTIONAL" | "COMPLETE" | null;
  display_model_type?: string;
  chips_required?: number; // Number of chips required (1 or 4)
}

export default function StepperDemo() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoDeployModel = searchParams.get("auto-deploy");

  const [totalSlots, setTotalSlots] = useState<number | null>(null);
  const isMultiChipBoard = totalSlots !== null && totalSlots > 1;

  // Fetch total_slots on mount to determine step count
  useEffect(() => {
    axios
      .get("/docker-api/chip-status/")
      .then((res) => setTotalSlots(res.data.total_slots ?? 1))
      .catch(() => setTotalSlots(1)); // safe fallback to single-chip
  }, []);

  const steps = isMultiChipBoard
    ? [
        { label: "Step 1", description: "Hardware Configuration" },
        { label: "Step 2", description: "Model Selection" },
        { label: "Final Step", description: "Deploy Model" },
      ]
    : [
        { label: "Step 1", description: "Model Selection" },
        { label: "Final Step", description: "Deploy Model" },
      ];

  // No-op function for removing dynamic steps (no dynamic steps in this component)
  const removeDynamicSteps = () => {
    // This component uses static steps, so no action needed
  };

  const [chipMode, setChipMode] = useState<"single" | "multi" | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(false);
  const [isAutoDeploying, setIsAutoDeploying] = useState(false);

  // Log when selectedModel changes
  useEffect(() => {
    console.log("🎯 selectedModel changed to:", selectedModel);
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
      const deviceIdParam = parseInt(searchParams.get("device-id") ?? "0", 10);
      const deployPayload = {
        model_id: model.id,
        weights_id: "", // Empty string for default weights
        device_id: isNaN(deviceIdParam) ? 0 : deviceIdParam,
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
    console.log("🚀 Simplified deployment flow: 2-step process");
    console.log("handleDeploy called with:", {
      selectedModel,
      isAutoDeploying,
    });

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 2500);

    const model_id = selectedModel || "0";
    const weights_id = ""; // Always use default weights

    const payload = JSON.stringify({
      model_id,
      weights_id,
      device_id: selectedDeviceId,
    });

    console.log("📦 Deploying with default weights:", { model_id, weights_id });

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

      // Check if this is a chip allocation conflict error
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const errorData = error.response.data;
        const errorType = errorData?.error_type;

        if (errorType === 'multi_chip_conflict') {
          // Multi-chip conflict with detailed information
          const conflicts = errorData?.conflicts || [];
          const message = errorData?.message || 'Multi-chip model requires all slots to be free';

          customToast.error(
            <div className="max-w-md">
              <p className="font-bold mb-2">Multi-chip Deployment Conflict</p>
              <p className="text-sm mb-2">{message}</p>

              {conflicts.length > 0 && (
                <div className="mt-3 p-2 bg-red-100 dark:bg-red-900/30 rounded">
                  <p className="text-xs font-semibold mb-1">Stop these models first:</p>
                  <ul className="text-xs space-y-1">
                    {conflicts.map((c: any, i: number) => (
                      <li key={i} className="flex items-center justify-between">
                        <span>• {c.model} (slot {c.slot})</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs mt-2 italic">Go to Models Deployed page to stop models.</p>
                </div>
              )}
            </div>,
            { duration: 15000 }
          );

          return { success: false };
        } else if (errorType === 'allocation_failed') {
          // General allocation failure (all slots occupied)
          const message = errorData?.message || 'All chip slots are occupied';
          customToast.error(`Chip Allocation Failed: ${message}`, { duration: 10000 });
          return { success: false };
        }
      }

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

  // Wait until we know total_slots to avoid re-mounting Stepper mid-render
  if (totalSlots === null) {
    return (
      <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
        <div className="p-8 text-sm text-gray-500 font-mono animate-pulse">
          Detecting hardware...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
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
              {/* Multi-chip flow: Step 1 = Hardware Config */}
              {isMultiChipBoard && step.label === "Step 1" && (
                <ChipConfigStep
                  onConfirm={(mode, slotId) => {
                    setChipMode(mode);
                    setSelectedDeviceId(slotId);
                  }}
                />
              )}
              {/* Multi-chip flow: Step 2 = Model Selection (with chipMode filter) */}
              {isMultiChipBoard && step.label === "Step 2" && (
                <FirstStepForm
                  setSelectedModel={(modelId: string) => {
                    console.log("🔄 setSelectedModel called with:", modelId);
                    setSelectedModel(modelId);
                  }}
                  setSelectedDeviceId={setSelectedDeviceId}
                  setFormError={setFormError}
                  autoDeployModel={autoDeployModel}
                  isAutoDeploying={isAutoDeploying}
                  chipMode={chipMode ?? undefined}
                />
              )}
              {/* Single-chip flow: Step 1 = Model Selection (no chipMode filter) */}
              {!isMultiChipBoard && step.label === "Step 1" && (
                <FirstStepForm
                  setSelectedModel={(modelId: string) => {
                    console.log("🔄 setSelectedModel called with:", modelId);
                    setSelectedModel(modelId);
                  }}
                  setSelectedDeviceId={setSelectedDeviceId}
                  setFormError={setFormError}
                  autoDeployModel={autoDeployModel}
                  isAutoDeploying={isAutoDeploying}
                />
              )}
              {/* Both flows: Final Step = Deploy */}
              {step.label === "Final Step" && (
                <DeployModelStep
                  selectedModel={selectedModel}
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
