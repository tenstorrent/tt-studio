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

// QB2 (P300Cx2) uses a simplified 2-step flow by default; hardware config is hidden behind a toggle.
const QB2_BOARD_TYPES = new Set(["P300Cx2"]);

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

  // For QB2 boards, hide the hardware config step by default and show a toggle instead.
  const isQB2 = chipStatus !== null && QB2_BOARD_TYPES.has(chipStatus.board_type);
  const [showHardwareConfig, setShowHardwareConfig] = useState(false);

  // On QB2, auto-enable hardware config when a single-chip model is already deployed
  // and there is still at least one free slot — lets the user pick which card to use
  // without needing to find the small toggle.
  useEffect(() => {
    if (!isQB2 || !chipStatus) return;
    const hasOccupiedSingleChip = chipStatus.slots.some(
      (s) => s.status === "occupied" && !s.is_multi_chip
    );
    const hasAvailable = chipStatus.slots.some((s) => s.status === "available");
    if (hasOccupiedSingleChip && hasAvailable) {
      setShowHardwareConfig(true);
    }
  }, [isQB2, chipStatus]);

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

  // showHardwareConfig drives the 3-step flow only for non-QB2 multi-chip boards by default,
  // or when the user explicitly enables it via the toggle on QB2.
  const useHardwareConfigStep = isMultiChipBoard && (!isQB2 || showHardwareConfig);

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
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);
  const [useImageOverride, setUseImageOverride] = useState(true);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(false);
  const [isAutoDeploying, setIsAutoDeploying] = useState(false);

  // Once the user confirms hardware config, show a summary on the completed Step 1 node.
  const hardwareConfigSummary = chipMode
    ? chipMode === "multi"
      ? "All chips"
      : selectedDeviceIds.length > 0
        ? `Single · Device${selectedDeviceIds.length > 1 ? "s" : ""} ${selectedDeviceIds.slice().sort((a, b) => a - b).join(", ")}`
        : "Single chip"
    : "Hardware Configuration";

  const steps = useHardwareConfigStep
    ? [
        { label: "Step 1", description: hardwareConfigSummary },
        { label: "Step 2", description: "Model Selection" },
        { label: "Final Step", description: "Deploy Model" },
      ]
    : [
        { label: "Step 1", description: "Model Selection" },
        { label: "Final Step", description: "Deploy Model" },
      ];

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
    device_id?: number | string;
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

    // Only include device_id when explicitly provided — omitting it lets the backend
    // auto-allocate the best slot (required for QB2 simplified flow).
    const payloadObj: Record<string, unknown> = {
      model_id,
      weights_id,
      host_port: options?.host_port ?? null,
      use_image_override: useImageOverride,
    };
    if (options?.device_id !== undefined) {
      payloadObj.device_id = options.device_id;
    }
    const payload = JSON.stringify(payloadObj);

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

          const conflictsSummary =
            conflicts.length > 0
              ? ` Stop these first: ${conflicts
                  .map((c: { model?: string; slot?: number }) => `${c.model ?? "Unknown"} (device ${c.slot ?? "?"})`)
                  .join(", ")}.`
              : "";
          customToast.error(`Multi-chip Deployment Conflict: ${message}.${conflictsSummary}`);

          return { success: false };
        } else if (errorType === 'allocation_failed') {
          // General allocation failure (all slots occupied)
          const message = errorData?.message || 'All devices are occupied';
          customToast.error(`Chip Allocation Failed: ${message}`);
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
        {/* QB2 image override toggle — only shown on P300Cx2 for whisper/speecht5 */}
        {isQB2 && (selectedModelName === "whisper-large-v3" || selectedModelName === "speecht5_tts") && (
          <div className="flex items-center justify-end gap-2 pb-2 pt-1 border-b border-gray-800 mb-2">
            <span className="text-xs font-mono text-gray-500 select-none">
              Use override image
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={useImageOverride}
              onClick={() => setUseImageOverride((v) => !v)}
              className={`
                relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
                transition-colors duration-200 focus:outline-none
                ${useImageOverride ? "bg-TT-purple-accent" : "bg-gray-700"}
              `}
            >
              <span
                className={`
                  pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform
                  transition-transform duration-200
                  ${useImageOverride ? "translate-x-4" : "translate-x-0"}
                `}
              />
            </button>
          </div>
        )}

        {/* QB2 hardware config toggle — only shown on P300Cx2 boards */}
        {isQB2 && (
          <div className="flex items-center justify-between gap-2 pb-2 pt-1 border-b border-gray-800 mb-2">
            <span className="text-sm font-mono text-gray-300 select-none">
              Advanced: Configure Hardware
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showHardwareConfig}
              onClick={() => {
                setShowHardwareConfig((v: boolean) => !v);
                // Reset chip mode when toggling off
                if (showHardwareConfig) setChipMode(null);
              }}
              className={`
                relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent
                transition-colors duration-200 focus:outline-none
                ${showHardwareConfig ? "bg-TT-purple-accent" : "bg-gray-700"}
              `}
            >
              <span
                className={`
                  pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform
                  transition-transform duration-200
                  ${showHardwareConfig ? "translate-x-4" : "translate-x-0"}
                `}
              />
            </button>
          </div>
        )}

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
              {/* Hardware config step — only in full multi-chip flow */}
              {useHardwareConfigStep && step.label === "Step 1" && (
                <ChipConfigStep
                  onConfirm={(mode, slotIds) => {
                    setChipMode(mode);
                    setSelectedDeviceIds(slotIds);
                  }}
                />
              )}
              {/* Model selection with chipMode filter — full multi-chip flow */}
              {useHardwareConfigStep && step.label === "Step 2" && (
                <FirstStepForm
                  setSelectedModel={(modelId: string) => {
                    console.log("🔄 setSelectedModel called with:", modelId);
                    setSelectedModel(modelId);
                  }}
                  onModelNameChange={setSelectedModelName}
                  setFormError={setFormError}
                  autoDeployModel={autoDeployModel}
                  isAutoDeploying={isAutoDeploying}
                  chipMode={chipMode ?? undefined}
                />
              )}
              {/* Model selection without chipMode filter — simplified flow (single-chip boards + QB2 default) */}
              {!useHardwareConfigStep && step.label === "Step 1" && (
                <FirstStepForm
                  setSelectedModel={(modelId: string) => {
                    console.log("🔄 setSelectedModel called with:", modelId);
                    setSelectedModel(modelId);
                  }}
                  onModelNameChange={setSelectedModelName}
                  setFormError={setFormError}
                  autoDeployModel={autoDeployModel}
                  isAutoDeploying={isAutoDeploying}
                />
              )}
              {/* Deploy step — pass selectedDeviceIds only when hardware config was shown */}
              {step.label === "Final Step" && (
                <DeployModelStep
                  selectedModel={selectedModel}
                  handleDeploy={handleDeploy}
                  selectedDeviceIds={useHardwareConfigStep ? selectedDeviceIds : undefined}
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
