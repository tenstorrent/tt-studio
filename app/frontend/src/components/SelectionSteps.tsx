// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Layers, Cpu, ArrowLeft } from "lucide-react";
import ElevatedCard from "./ui/elevated-card";
import { Step, Stepper } from "./ui/stepper";
import { customToast } from "./CustomToaster";
import StepperFooter from "./StepperFooter";
import { DeployModelStep } from "./DeployModelStep";
import { FirstStepForm } from "./FirstStepForm";
import { ChipConfigStep } from "./ChipConfigStep";
import { VoiceAgentSolutionStep } from "./VoiceAgentSolutionStep";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoDeployModel = searchParams.get("auto-deploy");

  const [chipStatus, setChipStatus] = useState<{
    board_type: string;
    total_slots: number;
    slots: { slot_id: number; status: string; model_name?: string; deployment_id?: number; is_multi_chip?: boolean }[];
  } | null>(null);
  const [totalSlots, setTotalSlots] = useState<number | null>(null);
  const isMultiChipBoard = totalSlots !== null && totalSlots > 1;

  // Fetch chip status on mount and poll every 7 minutes
  useEffect(() => {
    const fetchChipStatus = () => {
      axios
        .get("/docker-api/chip-status/")
        .then((res) => {
          setChipStatus(res.data);
          setTotalSlots(res.data.total_slots ?? 1);
        })
        .catch(() => {
          setChipStatus(null);
          setTotalSlots(1); // safe fallback to single-chip
        });
    };
    fetchChipStatus();
    const interval = setInterval(fetchChipStatus, 7 * 60 * 1000);
    return () => clearInterval(interval);
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

  const rawMode = searchParams.get("view");
  const deployMode: "solution" | "single" | null =
    rawMode === "solution" || rawMode === "single" ? rawMode : null;
  const setDeployMode = (mode: "solution" | "single" | null) => {
    if (mode === null) {
      const next = new URLSearchParams(searchParams);
      next.delete("view");
      setSearchParams(next, { replace: true });
    } else {
      setSearchParams({ ...Object.fromEntries(searchParams), view: mode }, { replace: true });
    }
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

  const handleDeploy = async (options?: {
    device_id?: number;
    host_port?: number | null;
  }): Promise<{
    success: boolean;
    job_id?: string;
  }> => {
    console.log("🚀 Simplified deployment flow: 2-step process");
    console.log("handleDeploy called with:", {
      selectedModel,
      isAutoDeploying,
      options,
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
      device_id: options?.device_id ?? 0,
      host_port: options?.host_port ?? null,
    });

    console.log("📦 Deploying with options:", { model_id, weights_id, ...options });

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
                        <span>• {c.model} (device {c.slot})</span>
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
          const message = errorData?.message || 'All devices are occupied';
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

  // Mode selector — show when no mode chosen yet
  if (deployMode === null) {
    return (
      <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
        <ElevatedCard
          accent="neutral"
          depth="lg"
          hover
          className="h-auto py-8 px-8 md:px-12 lg:px-16"
        >
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-xl font-semibold mb-1">How would you like to deploy?</h2>
              <p className="text-sm text-muted-foreground">Choose a deployment mode to get started.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Solutions card */}
              <button
                onClick={() => setDeployMode("solution")}
                className="text-left rounded-xl border-[2px] border-TT-purple/30 dark:border-TT-purple/40 bg-white/60 dark:bg-stone-900/60 p-6 flex flex-col gap-3 hover:border-TT-purple/70 dark:hover:border-TT-purple/60 hover:bg-TT-purple/5 dark:hover:bg-TT-purple/10 hover:shadow-[0_0_24px_rgba(124,104,250,0.25)] hover:scale-[1.015] active:scale-[0.99] transition-all duration-300 group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-TT-purple/10 dark:bg-TT-purple/20 text-TT-purple group-hover:bg-TT-purple/20 transition-colors">
                    <Layers className="w-5 h-5" />
                  </div>
                  <span className="font-semibold text-base">Solutions</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Deploy the full Voice Agent pipeline in one go — LLM, Whisper, and SpeechT5
                  each assigned to their own device.
                </p>
                <span className="text-xs font-medium text-TT-purple mt-1">
                  Recommended for voice agents →
                </span>
              </button>

              {/* Single / Multi model card */}
              <button
                onClick={() => setDeployMode("single")}
                className="text-left rounded-xl border-[2px] border-stone-200 dark:border-stone-700 bg-white/60 dark:bg-stone-900/60 p-6 flex flex-col gap-3 hover:border-stone-400 dark:hover:border-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800/60 hover:shadow-[0_0_20px_rgba(120,113,108,0.15)] hover:scale-[1.015] active:scale-[0.99] transition-all duration-300 group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 group-hover:bg-stone-200 dark:group-hover:bg-stone-700 transition-colors">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <span className="font-semibold text-base">Single / Multi Model Deployments</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Deploy individual models one at a time. Supports hardware configuration
                  for multi-chip boards.
                </p>
                <span className="text-xs font-medium text-muted-foreground mt-1">
                  Full control →
                </span>
              </button>
            </div>
          </div>
        </ElevatedCard>
      </div>
    );
  }

  // Solutions mode
  if (deployMode === "solution") {
    return (
      <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
        <ElevatedCard accent="neutral" depth="lg" hover className="h-auto py-4 px-8 md:px-12 lg:px-16">
          <VoiceAgentSolutionStep onBack={() => setDeployMode(null)} />
        </ElevatedCard>
      </div>
    );
  }

  // Single/multi model mode — existing stepper
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
        <button
          onClick={() => setDeployMode(null)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />Back to deployment options
        </button>
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
                  selectedDeviceId={isMultiChipBoard ? selectedDeviceId : undefined}
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
