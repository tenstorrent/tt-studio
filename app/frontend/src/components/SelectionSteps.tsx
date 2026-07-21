// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Layers, Cpu, ArrowLeft, ChevronDown, Loader2, Rocket, AlertTriangle } from "lucide-react";
import ElevatedCard from "./ui/elevated-card";
import { Step, Stepper, useStepper } from "./ui/stepper";
import { customToast } from "./CustomToaster";
import StepperFooter from "./StepperFooter";
import { DeployModelStep } from "./DeployModelStep";
import { FirstStepForm } from "./FirstStepForm";
import { ChipConfigStep } from "./ChipConfigStep";
import { VoiceAgentSolutionStep } from "./VoiceAgentSolutionStep";
import { DeploymentTray } from "./DeploymentTray";
import { useActiveDeployments } from "../hooks/useActiveDeployments";
import type { ChipStatus } from "../types/chipStatus";
import {
  autoPlacement,
  fullBoardSlots,
  getModelPlacement,
  isMultiChipModel,
} from "../utils/deviceFit";
import { parseDeviceIds } from "../utils/p300x2Placement";

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

// P300x2 uses a simplified 2-step flow by default; hardware config is hidden behind a toggle.
const QB2_BOARD_TYPES = new Set(["P300x2"]);

// Reports the stepper's active step up to the card header (which renders outside
// the stepper context) so the advanced toggle can be shown only on the deploy step.
function StepWatcher({ onChange }: { onChange: (step: number) => void }) {
  const { activeStep } = useStepper();
  useEffect(() => {
    onChange(activeStep);
  }, [activeStep, onChange]);
  return null;
}

export default function StepperDemo() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const autoDeployModel = searchParams.get("auto-deploy");

  const [chipStatus, setChipStatus] = useState<ChipStatus | null>(null);
  const [totalSlots, setTotalSlots] = useState<number | null>(null);
  const isMultiChipBoard = totalSlots !== null && totalSlots > 1;

  // Model catalog (with per-board compatibility) — used to decide whether the
  // Voice Agent solution is even deployable on this hardware. null = not loaded yet.
  const [models, setModels] = useState<Model[] | null>(null);

  // QB2 still drives the whisper/speecht5 image-override toggle below.
  const isQB2 = chipStatus !== null && QB2_BOARD_TYPES.has(chipStatus.board_type);
  // Advanced hardware config is opt-in via the Step 2 toggle (multi-chip boards only).
  const [showHardwareConfig, setShowHardwareConfig] = useState(false);
  // Active stepper step, mirrored out via StepWatcher (0 = model selection, 1 = deploy).
  const [activeStep, setActiveStep] = useState(0);

  const fetchChipStatus = useCallback(() => {
    axios
      .get<ChipStatus>("/docker-api/chip-status/")
      .then((res) => {
        setChipStatus(res.data);
        setTotalSlots(res.data.total_slots ?? 1);
      })
      .catch(() => {
        setChipStatus(null);
        setTotalSlots(1); // safe fallback to single-chip
      });
  }, []);

  // Session-wide tracker for in-flight deploys. Refresh chip-status whenever one
  // resolves so a freed (failed) or newly-claimed (completed) slot is reflected.
  const { deployments, progressByJob, addDeployment, removeDeployment, reservedDeviceIds } =
    useActiveDeployments({ onResolved: () => fetchChipStatus() });
  const hasActiveDeployments = deployments.some((d) => d.status === "active");

  // Poll chip status faster while deploys are in flight (a pending slot must grey
  // out promptly), and idle-poll otherwise.
  useEffect(() => {
    fetchChipStatus();
    const interval = setInterval(fetchChipStatus, hasActiveDeployments ? 5000 : 7 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchChipStatus, hasActiveDeployments]);

  // Overlay reserved devices onto chip-status so the model list greys out
  // configurations a pending deploy already claimed — before the backend
  // (which only reserves media slots once their image pull finishes) catches up.
  const effectiveChipStatus = useMemo(() => {
    if (!chipStatus || reservedDeviceIds.length === 0) return chipStatus;
    const reserved = new Set(reservedDeviceIds);
    const nameByDevice = new Map<number, string>();
    deployments
      .filter((d) => d.status === "active")
      .forEach((d) => d.deviceIds.forEach((id) => {
        if (!nameByDevice.has(id)) nameByDevice.set(id, d.modelName);
      }));
    return {
      ...chipStatus,
      slots: chipStatus.slots.map((s) =>
        reserved.has(s.slot_id) && s.status !== "occupied"
          ? { ...s, status: "occupied" as const, model_name: s.model_name ?? nameByDevice.get(s.slot_id) }
          : s
      ),
    };
  }, [chipStatus, reservedDeviceIds, deployments]);

  // Fetch the model catalog once to determine Voice Agent availability for this board.
  useEffect(() => {
    axios
      .get(getModelsUrl)
      .then((res) => setModels(Array.isArray(res.data) ? res.data : []))
      .catch(() => setModels([])); // on error, treat as no models → single-model only
  }, []);

  // Advanced config is reachable only after a model is chosen, on multi-chip boards.
  const advancedActive = isMultiChipBoard && showHardwareConfig;

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
      const next = new URLSearchParams(searchParams);
      next.set("view", mode);
      setSearchParams(next, { replace: true });
    }
  };

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);
  const [useImageOverride, setUseImageOverride] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState(false);
  const [isAutoDeploying, setIsAutoDeploying] = useState(false);
  // Phase of the CLI-triggered auto-deploy, surfaced in the overlay below.
  const [autoDeployStatus, setAutoDeployStatus] = useState("Preparing…");
  const [autoDeployError, setAutoDeployError] = useState<string | null>(null);

  // Chip requirement of the currently selected model (selectedModel holds the id).
  const selectedModelChips =
    models?.find((m) => m.id === selectedModel)?.chips_required ?? 1;

  // Supported device configurations for the selected model (single source of truth).
  const placement = getModelPlacement(
    selectedModelName ?? selectedModel ?? "",
    selectedModelChips,
    effectiveChipStatus?.board_type
  );
  // Flexible models (e.g. Llama 3.1 8B on P300x2) can run as a card pair or full-board.
  const isFlexible = placement.cardGroups.length > 0;
  const allSlotsSelected =
    selectedDeviceIds.length > 0 && selectedDeviceIds.length === (totalSlots ?? 0);
  // In auto mode, the best currently-available placement (accounting for in-flight
  // reservations): full board, else a free card pair (flexible), else the lowest
  // free slot. null when nothing fits.
  const autoPlace = advancedActive
    ? null
    : autoPlacement(placement, selectedModelChips, effectiveChipStatus?.slots ?? [], totalSlots ?? 4);
  // The full-board (force_full_board) flow applies only to flexible models.
  const fullBoardSelected =
    isFlexible && (advancedActive ? allSlotsSelected : !!autoPlace?.fullBoard);
  // Chips the deployment actually occupies (full-board takes every slot).
  const effectiveChips = fullBoardSelected ? 4 : selectedModelChips;
  // Devices shown in the deploy preview; undefined means the backend auto-allocates.
  const previewDeviceIds: number[] | undefined = (() => {
    if (!advancedActive) return autoPlace?.deviceIds;
    const board = fullBoardSlots(totalSlots ?? 4);
    if (placement.allowsFullBoard && !isFlexible) return board; // true multi-chip
    if (isFlexible) {
      return fullBoardSelected ? board : selectedDeviceIds.length ? selectedDeviceIds : undefined;
    }
    return selectedDeviceIds.length ? selectedDeviceIds : undefined;
  })();
  // Auto mode with no available configuration → block deploy with a clear reason.
  const placementBlocked = !advancedActive && !!chipStatus && autoPlace === null;
  // Single-device and flexible models in advanced mode need an explicit pick;
  // true multi-chip models auto-allocate the whole board.
  const requireDeviceSelection =
    advancedActive && !isMultiChipModel(selectedModelChips);

  // Models with a deploy already in flight — stay selectable (so the user can
  // reconnect to their progress) rather than being greyed by their own reservation.
  const deployingModelIds = useMemo(
    () => new Set(deployments.filter((d) => d.status === "active").map((d) => d.modelId)),
    [deployments]
  );
  // The deploy (if any) for the currently selected model — resumed in the deploy
  // step. Prefer the active run; fall back to a just-completed one so the deploy
  // step can show success and redirect instead of reverting to the button.
  const deploymentForSelected =
    deployments.find((d) => d.modelId === selectedModel && d.status === "active") ??
    deployments.find((d) => d.modelId === selectedModel && d.status === "completed");
  const progressForSelected = deploymentForSelected
    ? progressByJob[deploymentForSelected.jobId] ?? null
    : null;

  const steps = [
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
      setAutoDeployStatus(`Resolving “${modelName}” in the catalog…`);

      // Find the model by name — exact match first, then a unique substring
      // match, mirroring the CLI's resolve_model_id so both paths behave alike.
      const response = await axios.get("/docker-api/get_containers/");
      const models: { id: string; name: string }[] = response.data;
      const needle = modelName.toLowerCase();
      let model = models.find((m) => m.name.toLowerCase() === needle);
      if (!model) {
        const loose = models.filter((m) =>
          m.name.toLowerCase().includes(needle)
        );
        if (loose.length === 1) {
          model = loose[0];
        } else if (loose.length > 1) {
          const msg = `"${modelName}" matched multiple models: ${loose
            .map((m) => m.name)
            .join(", ")}. Re-run with an exact name.`;
          customToast.error(`Auto-deploy: ${msg}`);
          setAutoDeployError(msg);
          return;
        }
      }

      if (!model) {
        const msg = `Model "${modelName}" not found in the catalog.`;
        customToast.error(`Auto-deploy: ${msg}`);
        setAutoDeployError(msg);
        console.error("Model not found:", modelName);
        return;
      }

      console.log("Found model for auto-deploy:", model);

      // Deploy with default weights. Include device_id only when the CLI passed
      // ?device-id=; omitting it lets the backend allocate based on the model.
      const deployPayload: Record<string, unknown> = {
        model_id: model.id,
        weights_id: "", // Empty string for default weights
      };
      // device-id may be a single chip ("0") or a comma-separated list ("0,1")
      // for multi-chip models. Send a number for one chip, a joined string for
      // several — matching the manual deploy path in DeployModelStep.
      const deviceIdParam = searchParams.get("device-id");
      if (deviceIdParam !== null && deviceIdParam !== "") {
        const ids = parseDeviceIds(deviceIdParam);
        if (ids.length === 1) {
          deployPayload.device_id = ids[0];
        } else if (ids.length > 1) {
          deployPayload.device_id = ids.join(",");
        }
      }

      console.log("Auto-deploy payload:", deployPayload);
      setAutoDeployStatus(`Starting deployment of ${model.name}…`);

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
      setAutoDeployStatus("Deployment started — opening Models Deployed…");

      // Navigate to deployed models page after short delay
      setTimeout(() => {
        navigate("/models-deployed");
      }, 1500);
    } catch (error) {
      console.error("Auto-deployment failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      customToast.error(`Auto-deployment failed: ${errorMessage}`);
      setAutoDeployError(errorMessage);
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

    let resolvedDeviceId = options?.device_id;
    // Full-board flow omits device_id (force_full_board). Otherwise, in auto mode a
    // flexible model deploys onto its resolved card pair; manual mode already carries
    // the picked devices in options.device_id.
    if (fullBoardSelected) {
      resolvedDeviceId = undefined;
    } else if (!advancedActive && isFlexible && autoPlace && autoPlace.deviceIds.length > 1) {
      resolvedDeviceId = autoPlace.deviceIds.join(",");
    }

    // Only include device_id when explicitly provided — omitting it lets the backend
    // auto-allocate the best slot (required for QB2 simplified flow).
    const payloadObj: Record<string, unknown> = {
      model_id,
      weights_id,
      host_port: options?.host_port ?? null,
      use_image_override: useImageOverride,
    };
    if (fullBoardSelected) {
      payloadObj.force_full_board = true;
    }
    if (resolvedDeviceId !== undefined) {
      payloadObj.device_id = resolvedDeviceId;
    }
    const payload = JSON.stringify(payloadObj);

    console.log("📦 Deploying with options:", {
      model_id,
      weights_id,
      ...options,
      resolvedDeviceId,
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

      if (
        axios.isAxiosError(error) &&
        error.response?.status === 400 &&
        error.response?.data?.error_code === "hf_access_denied"
      ) {
        const { message, hf_url } = error.response.data;
        customToast.error(
          `${message} Open ${hf_url} to request access.`,
        );
        return { success: false };
      }

      // Check if this is a chip allocation conflict error
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const errorData = error.response.data;
        const errorType = errorData?.error_type;

        if (errorType === 'multi_chip_conflict') {
          // Multi-chip conflict with detailed information
          const conflicts = errorData?.conflicts || [];
          const message = errorData?.message || 'Multi-device model requires all slots to be free';

          const conflictsSummary =
            conflicts.length > 0
              ? ` Stop these first: ${conflicts
                .map((c: { model?: string; slot?: number }) => `${c.model ?? "Unknown"} (device ${c.slot ?? "?"})`)
                .join(", ")}.`
              : "";
          customToast.error(`Multi-device Deployment Conflict: ${message}.${conflictsSummary}`);

          return { success: false };
        } else if (errorType === 'allocation_failed') {
          // General allocation failure (all slots occupied)
          const message = errorData?.message || 'All devices are occupied';
          customToast.error(`Device Allocation Failed: ${message}`);
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

  // CLI-triggered auto-deploy (?auto-deploy=<model>): take over the whole view with
  // a clear status overlay so it's obvious the deploy was kicked off from the
  // terminal and is running — rather than silently posting and redirecting.
  if (isAutoDeploying) {
    const failed = autoDeployError !== null;
    return (
      <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
        <ElevatedCard accent="neutral" depth="lg" className="h-auto py-10 px-8 md:px-12">
          <div className="flex flex-col items-center text-center gap-5">
            <div
              className={`p-4 rounded-full ${
                failed
                  ? "bg-red-500/10 text-red-500"
                  : "bg-TT-purple/10 dark:bg-TT-purple/20 text-TT-purple"
              }`}
            >
              {failed ? (
                <AlertTriangle className="w-8 h-8" />
              ) : (
                <Rocket className="w-8 h-8" />
              )}
            </div>

            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">
                {failed ? "Auto-deploy failed" : "Auto-deploying from the CLI"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {failed ? (
                  "You can deploy manually below instead."
                ) : (
                  <>
                    Launched with{" "}
                    <code className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 font-mono text-xs">
                      run {autoDeployModel}
                    </code>
                    . Bringing this model up — no clicks needed.
                  </>
                )}
              </p>
            </div>

            {failed ? (
              <>
                <p className="text-sm text-red-500 max-w-md">{autoDeployError}</p>
                <button
                  onClick={() => {
                    setIsAutoDeploying(false);
                    setAutoDeployError(null);
                  }}
                  className="mt-1 rounded-lg border-[2px] border-TT-purple/40 px-4 py-2 text-sm font-medium text-TT-purple hover:bg-TT-purple/10 transition-colors"
                >
                  Deploy manually
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{autoDeployStatus}</span>
              </div>
            )}
          </div>
        </ElevatedCard>
      </div>
    );
  }

  // Wait until the model catalog is known before deciding what to offer — avoids
  // flashing the Solutions card (or the single flow) before per-board compatibility
  // is resolved.
  if (models === null) {
    return (
      <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto px-6 md:px-8 lg:px-12 pt-8 pb-4 md:pt-12 md:pb-8">
        <div className="p-8 text-sm text-gray-500 font-mono animate-pulse">
          Detecting hardware...
        </div>
      </div>
    );
  }

  // The Voice Agent solution needs a board-compatible LLM, STT and TTS model. On
  // hardware that can't run all three (e.g. P100, where only the LLM is supported),
  // hide the Solutions card and offer single-model deployment only.
  const hasCompatType = (t: string) =>
    models.some((m) => m.model_type === t && m.is_compatible === true);
  const voiceAgentAvailable =
    hasCompatType("chat") &&
    hasCompatType("speech_recognition") &&
    hasCompatType("tts");
  const effectiveMode = voiceAgentAvailable ? deployMode : "single";

  // Mode selector — show when no mode chosen yet
  if (effectiveMode === null) {
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
                  for multi-device boards.
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
  if (effectiveMode === "solution") {
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
        {/* QB2 image override toggle — only shown on P300x2 for whisper/speecht5 */}
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

        {(voiceAgentAvailable || (isMultiChipBoard && activeStep === 1)) && (
          <div className="flex items-center mb-4">
            {voiceAgentAvailable && (
              <button
                onClick={() => setDeployMode(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />Back to deployment options
              </button>
            )}
            {isMultiChipBoard && activeStep === 1 && (
              <button
                type="button"
                aria-expanded={showHardwareConfig}
                onClick={() => {
                  setShowHardwareConfig((v: boolean) => !v);
                  if (showHardwareConfig) setSelectedDeviceIds([]);
                }}
                className={`group ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors focus:outline-none ${
                  showHardwareConfig
                    ? "bg-TT-purple/10 text-TT-purple-accent font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Cpu className={`w-3.5 h-3.5 ${showHardwareConfig ? "" : "opacity-70"}`} />
                <span>Advanced device configuration</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${showHardwareConfig ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>
        )}
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
              {/* Step 1 — model selection, greying out models that can't fit free devices */}
              {step.label === "Step 1" && (
                <FirstStepForm
                  setSelectedModel={(modelId: string) => {
                    console.log("🔄 setSelectedModel called with:", modelId);
                    setSelectedModel(modelId);
                  }}
                  onModelNameChange={setSelectedModelName}
                  setFormError={setFormError}
                  chipStatus={effectiveChipStatus}
                  deployingModelIds={deployingModelIds}
                />
              )}
              {/* Final step — optional advanced hardware config, then deploy */}
              {step.label === "Final Step" && (
                <>
                  {advancedActive && (
                    <ChipConfigStep
                      placement={placement}
                      onConfirm={setSelectedDeviceIds}
                      chipStatus={effectiveChipStatus}
                    />
                  )}
                  <DeployModelStep
                    selectedModel={selectedModel}
                    handleDeploy={handleDeploy}
                    selectedDeviceIds={advancedActive ? selectedDeviceIds : undefined}
                    chipsRequired={effectiveChips}
                    previewDeviceIds={previewDeviceIds}
                    requireDeviceSelection={requireDeviceSelection}
                    deviceAutoSelected={!advancedActive}
                    placementBlocked={placementBlocked}
                    chipStatus={effectiveChipStatus}
                    registerDeployment={(d) => addDeployment({ ...d, startedAt: Date.now() })}
                    activeDeployment={deploymentForSelected}
                    activeProgress={progressForSelected}
                  />
                </>
              )}
            </Step>
          ))}
          <StepWatcher onChange={setActiveStep} />
          <div className="py-12">
            <StepperFooter removeDynamicSteps={removeDynamicSteps} />
          </div>
        </Stepper>
      </ElevatedCard>

      {/* Floating, minimizable deployment banner (fixed, bottom-right). Stays
          mounted across Prev/Next so parallel deploys remain visible regardless of
          the active step. Lists every deploy — including the one whose detailed bar
          is also open in the deploy step. */}
      <DeploymentTray
        deployments={deployments}
        progressByJob={progressByJob}
        onDismiss={removeDeployment}
      />
    </div>
  );
}
