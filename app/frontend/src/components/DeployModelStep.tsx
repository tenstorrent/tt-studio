// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
"use client";

import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { AnimatedDeployButton } from "./magicui/AnimatedDeployButton";
import { StepperFormActions } from "./StepperFormActions";
import { useRefresh } from "../hooks/useRefresh";
import { useIsResetting } from "../hooks/useIsResetting";
import { DeploymentProgress } from "./ui/DeploymentProgress";
import { cancelDeployment } from "../api/modelsDeployedApis";
import { getSettings } from "../api/settingsApi";
import { useActiveDeploymentsContext } from "../providers/ActiveDeploymentsContext";
import type { ActiveDeployment, DeploymentProgressData } from "../hooks/useActiveDeployments";
import { Cpu, AlertTriangle, ExternalLink, Info, CheckCircle, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import type { ChipStatus } from "../types/chipStatus";
import {
  fetchMergedCheckpoints,
  formatTrainingTimestamp,
  type MergedCheckpoint,
} from "../api/trainingApi";

// Sentinel Select value for "use base model" (no adapter). SelectItem rejects an
// empty-string value, so we use an explicit sentinel and treat it as "no adapter".
const BASE_MODEL_VALUE = "__base_model__";

export function DeployModelStep({
  handleDeploy,
  selectedModel,
  selectedDeviceIds,
  chipsRequired,
  previewDeviceIds,
  requireDeviceSelection,
  deviceAutoSelected,
  placementBlocked,
  chipStatus,
  registerDeployment,
  activeDeployment,
  activeProgress,
}: {
  selectedModel: string | null;
  handleDeploy: (options?: {
    device_id?: number | string;
    host_port?: number | null;
    host_weights_dir?: string;
  }) => Promise<{ success: boolean; job_id?: string }>;
  selectedDeviceIds?: number[];
  chipsRequired?: number;
  // Devices to show in the preview
  previewDeviceIds?: number[];
  // True only when the user must manually pick a device before deploying.
  requireDeviceSelection?: boolean;
  // True when the preview devices were auto-allocated rather than user-picked.
  deviceAutoSelected?: boolean;
  // True when no valid device configuration is currently free (auto mode).
  placementBlocked?: boolean;
  // Reservation-aware chip status from the parent (in-flight deploys overlaid)
  chipStatus?: ChipStatus | null;
  // Registers a fired deploy with the session-wide tracker (progress tray + reservations).
  registerDeployment: (d: {
    jobId: string;
    modelId: string;
    modelName: string;
    deviceIds: number[];
  }) => void;
  // Set when the selected model already has a deploy in flight — we resume its
  // progress bar here instead of offering the deploy button again.
  activeDeployment?: ActiveDeployment;
  activeProgress?: DeploymentProgressData | null;
}) {
  const { triggerRefresh, triggerHardwareRefresh } = useRefresh();
  const navigate = useNavigate();
  const { removeDeployment } = useActiveDeploymentsContext();
  // Block deployment while a board/device reset is in progress.
  const isResetting = useIsResetting();
  const [modelName, setModelName] = useState<string | null>(null);
  // Merged LoRA checkpoints available for this model (empty when none exist).
  const [mergedCheckpoints, setMergedCheckpoints] = useState<MergedCheckpoint[]>([]);
  // Selected merged-checkpoint host path, or BASE_MODEL_VALUE for the base model.
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string>(BASE_MODEL_VALUE);
  // A missing HF token is the most common reason a deploy of a gated model
  // stalls at 0% — warn up front and sharpen the stall message in the progress
  // card. On lookup failure stay silent rather than warn spuriously.
  const [hfTokenMissing, setHfTokenMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((s) => {
        if (!cancelled) setHfTokenMissing(!s.hf_token.set);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const slotInfo = useMemo(() => {
    if (!chipStatus) {
      return { totalSlots: 0, availableSlots: 0, occupiedDetails: [] as { slot_id: number; model_name: string; port?: number }[] };
    }
    const occupied = chipStatus.slots.filter((s) => s.status === "occupied");
    return {
      totalSlots: chipStatus.total_slots,
      availableSlots: chipStatus.total_slots - occupied.length,
      occupiedDetails: occupied.map((s) => ({
        slot_id: s.slot_id,
        model_name: s.model_name || "Unknown",
        port: s.port,
      })),
    };
  }, [chipStatus]);

  useEffect(() => {
    const fetchModelName = async () => {
      if (selectedModel) {
        try {
          const response = await axios.get(`/docker-api/get_containers/`);
          const models = response.data;
          const model = models.find(
            (m: { id: string; name: string }) => m.id === selectedModel
          );
          if (model) {
            setModelName(model.name);
          }
        } catch (error) {
          console.error("Error fetching model name:", error);
        }
      }
    };

    fetchModelName();
  }, [selectedModel]);

  // Discover merged LoRA checkpoints (adapters promoted for inference) for the
  // selected model. Only valid HF checkpoints are offered; if none exist the
  // picker is hidden and deployment uses the base model as before.
  useEffect(() => {
    let cancelled = false;
    setSelectedCheckpoint(BASE_MODEL_VALUE);
    setMergedCheckpoints([]);
    if (!selectedModel) return;
    (async () => {
      try {
        const all = await fetchMergedCheckpoints(selectedModel);
        if (!cancelled) setMergedCheckpoints(all.filter((c) => c.valid));
      } catch (error) {
        console.error("Error fetching merged checkpoints:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedModel]);

  const isMultiModel = (chipsRequired ?? 1) > 1;
  const fullBoardMax = Math.min(4, slotInfo.totalSlots || 1);
  // placementBlocked: the parent already determined no valid configuration is free.
  // Otherwise: a full-board model needs slots 0..3 free, a single-device model any free slot.
  const cannotFit =
    !!placementBlocked ||
    (slotInfo.totalSlots > 0 &&
      (isMultiModel
        ? slotInfo.occupiedDetails.length > 0
        : slotInfo.availableSlots === 0));
  // Only models that require a manual pick block deploy until a slot is chosen.
  const needsSelection =
    !!requireDeviceSelection && (selectedDeviceIds?.length ?? 0) === 0;

  const deployButtonText = useMemo(() => {
    if (isResetting) return "Board Resetting…";
    if (cannotFit) return isMultiModel ? "Devices In Use" : "All Devices Occupied";
    if (!selectedModel) return "Select a Model";
    if (needsSelection) return "Select a Device";
    return "Deploy Model";
  }, [selectedModel, cannotFit, isMultiModel, needsSelection, isResetting]);

  const isDeployDisabled =
    !selectedModel || cannotFit || needsSelection || isResetting;

  const onDeploy = useCallback(async () => {
    if (isDeployDisabled) return { success: false };

    const deployOptions: {
      device_id?: number | string;
      host_port?: number | null;
      host_weights_dir?: string;
    } = {};
    if (selectedDeviceIds !== undefined && selectedDeviceIds.length > 0) {
      const sorted = selectedDeviceIds.slice().sort((a, b) => a - b);
      deployOptions.device_id = sorted.length === 1 ? sorted[0] : sorted.join(",");
    }
    // A selected merged checkpoint loads its weights via --host-weights-dir; the
    // base-model sentinel deploys the base weights (no flag passed).
    if (selectedCheckpoint && selectedCheckpoint !== BASE_MODEL_VALUE) {
      deployOptions.host_weights_dir = selectedCheckpoint;
    }
    return handleDeploy(deployOptions);
  }, [handleDeploy, isDeployDisabled, selectedDeviceIds, selectedCheckpoint]);

  // Hand a fired deploy to the session tracker, then let refresh hooks update
  // the rest of the app (models list / hardware view) in the background.
  const onDeployStarted = useCallback(
    (jobId: string) => {
      if (!selectedModel) return;
      registerDeployment({
        jobId,
        modelId: selectedModel,
        modelName: modelName ?? selectedModel,
        deviceIds: previewDeviceIds ?? [],
      });
      triggerRefresh();
      triggerHardwareRefresh();
    },
    [selectedModel, modelName, previewDeviceIds, registerDeployment, triggerRefresh, triggerHardwareRefresh]
  );

  const handleGoToDeployedModels = () => {
    navigate("/models-deployed");
  };

  // The selected model just finished — briefly confirm then hand off to the Models Deployed page.
  const isDeploymentComplete = activeDeployment?.status === "completed";
  useEffect(() => {
    if (!isDeploymentComplete) return;
    const timer = setTimeout(() => navigate("/models-deployed"), 1500);
    return () => clearTimeout(timer);
  }, [isDeploymentComplete, navigate]);

  // Show the blocking "board full" warning, but suppress the flash after a
  // cancel/complete: while this model's deploy is in flight we never warn, and for a
  // few seconds after it ends we hold off so chip-status can catch up to the freed slot
  const [showSlotsFullWarning, setShowSlotsFullWarning] = useState(false);
  const wasActiveRef = useRef(false);
  const leftActiveAtRef = useRef(0);
  useEffect(() => {
    const isActive = !!activeDeployment;
    if (wasActiveRef.current && !isActive) leftActiveAtRef.current = Date.now();
    wasActiveRef.current = isActive;
  }, [activeDeployment]);
  useEffect(() => {
    if (activeDeployment || !cannotFit) {
      setShowSlotsFullWarning(false);
      return;
    }
    const sinceLeftActive = Date.now() - leftActiveAtRef.current;
    const delay = sinceLeftActive < 6000 ? 6000 - sinceLeftActive : 400;
    const timer = setTimeout(() => setShowSlotsFullWarning(true), delay);
    return () => clearTimeout(timer);
  }, [cannotFit, activeDeployment]);
  // Show informational status when some slots are in use but the model still fits
  const showSlotInfo = !cannotFit && slotInfo.occupiedDetails.length > 0;

  // The selected model just finished — confirm success and redirect
  if (activeDeployment && isDeploymentComplete) {
    return (
      <>
        <div className="flex flex-col items-center justify-center p-6 text-center" style={{ minHeight: "200px" }}>
          <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
          <h3 className="text-lg font-semibold text-green-700 dark:text-green-300 mb-1">
            {activeDeployment.modelName} deployed
          </h3>
          <p className="text-sm text-muted-foreground">
            Taking you to the Deployed Models page…
          </p>
        </div>
        <StepperFormActions removeDynamicSteps={() => { }} />
      </>
    );
  }

  // The selected model is already deploying — resume its progress bar in place of
  // the deploy button so the user reconnects to the exact run they started.
  if (activeDeployment) {
    return (
      <>
        <div className="flex flex-col items-center justify-center p-6" style={{ minHeight: "200px" }}>
          <div className="w-full max-w-md">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="h-4 w-4 text-TT-purple-accent" />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {activeDeployment.modelName}
              </span>
            </div>
            <DeploymentProgress
              progress={
                activeProgress ?? {
                  status: "starting",
                  stage: "starting",
                  progress: 0,
                  message: "Starting deployment…",
                }
              }
              startTime={activeDeployment.startedAt}
              imagePulled={activeDeployment.hadImagePull}
              hfTokenMissing={hfTokenMissing}
              onCancel={() => {
                void cancelDeployment(activeDeployment.jobId);
                removeDeployment(activeDeployment.jobId);
              }}
            />
            <p className="mt-3 text-xs text-muted-foreground text-center">
              This model is already deploying. Go back to deploy another model in parallel,
              or view it on the Deployed Models page.
            </p>
            <div className="mt-3 flex justify-center">
              <Button variant="outline" size="sm" onClick={handleGoToDeployedModels}>
                <ExternalLink className="h-3 w-3 mr-1.5" />
                Manage Deployed Models
              </Button>
            </div>
          </div>
        </div>
        <StepperFormActions removeDynamicSteps={() => { }} />
      </>
    );
  }

  return (
    <>
      <div
        className="flex flex-col items-center justify-center p-6 overflow-hidden"
        style={{ minHeight: "200px" }}
      >
        {/* Board reset in progress — deployment is paused */}
        {isResetting && (
          <div className="w-full max-w-2xl mb-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-1">
                    Board reset in progress
                  </h4>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Deployment is paused while the board resets — about a minute or two.
                    Try again once it finishes.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Missing HF token: gated model deploys will hang at 0% waiting for
            credentials, so warn before the user starts one. Non-blocking —
            ungated models still deploy fine without a token. */}
        {hfTokenMissing && (
          <div className="w-full max-w-2xl mb-6">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                    No Hugging Face token configured
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Deploys of gated models (Llama, Gemma, …) will stall at 0%
                    without one. Set it in Settings (gear icon in the navbar),
                    or add <code className="font-mono">HF_TOKEN</code> to the{" "}
                    <code className="font-mono">.env</code> file at the repo
                    root and restart TT-Studio.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Show blocking warning when ALL chip slots are occupied */}
        {showSlotsFullWarning && (
          <div className="w-full max-w-2xl mb-6">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                    {isMultiModel
                      ? "Not Enough Free Devices"
                      : slotInfo.availableSlots > 0
                        ? "No Free Device Configuration"
                        : "All Devices Occupied"}
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    {isMultiModel
                      ? `${modelName || "This model"} needs all ${fullBoardMax} devices. In use: `
                      : slotInfo.availableSlots > 0
                        ? `${modelName || "This model"} has no free device configuration right now. In use: `
                        : `All ${slotInfo.totalSlots} devices are in use: `}
                    {slotInfo.occupiedDetails
                      .map((s) => `${s.model_name} (device ${s.slot_id}${s.port ? ` :${s.port}` : ""})`)
                      .join(", ")}
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    Free up {isMultiModel || slotInfo.availableSlots > 0 ? "devices" : "a device"} before deploying this model.
                  </p>
                  <Button
                    onClick={handleGoToDeployedModels}
                    variant="outline"
                    size="sm"
                    className="mt-3 border-yellow-300 text-yellow-700 hover:bg-yellow-100 dark:border-yellow-700 dark:text-yellow-300 dark:hover:bg-yellow-900/30"
                  >
                    <ExternalLink className="h-3 w-3 mr-1.5" />
                    Manage Deployed Models
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Informational slot status when some slots are in use but more are available */}
        {showSlotInfo && (
          <div className="w-full max-w-2xl mb-4">
            <div className="bg-blue-50 dark:bg-blue-900/15 border border-blue-200 dark:border-blue-800/50 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  {slotInfo.occupiedDetails.length}/{slotInfo.totalSlots} device{slotInfo.occupiedDetails.length > 1 ? "s" : ""} in use
                  {" — "}
                  {slotInfo.availableSlots} available
                </span>
              </div>
            </div>
          </div>
        )}

        <AnimatedDeployButton
          initialText={<span>{deployButtonText}</span>}
          changeText={<span>Deploying Model...</span>}
          onDeploy={onDeploy}
          disabled={isDeployDisabled}
          onDeployStarted={onDeployStarted}
        />
        <div className="mt-6 flex flex-col items-center justify-center space-y-2">
          {modelName && (
            <div className="flex items-center space-x-2">
              <Cpu className="text-TT-purple-accent" />
              <span className="text-sm text-gray-800 dark:text-gray-400">
                Model:
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {modelName}
              </span>
            </div>
          )}
          {previewDeviceIds && previewDeviceIds.length > 0 && (
            <div className="flex items-center space-x-2">
              <Cpu className="text-TT-purple-accent" />
              <span className="text-sm text-gray-800 dark:text-gray-400">
                {previewDeviceIds.length > 1 ? "Devices:" : "Device:"}
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {previewDeviceIds.slice().sort((a, b) => a - b).join(", ")}
              </span>
              {deviceAutoSelected && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  (auto-selected)
                </span>
              )}
            </div>
          )}
          {(!previewDeviceIds || previewDeviceIds.length === 0) &&
            modelName &&
            !cannotFit &&
            !needsSelection && (
              <div className="flex items-center space-x-2">
                <Cpu className="text-TT-purple-accent" />
                <span className="text-sm text-gray-800 dark:text-gray-400">Device:</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                  Auto · next free device
                </span>
              </div>
            )}
        </div>

        {/* Fine-tuned weights picker — only shown when merged LoRA checkpoints
            exist for this model. Defaults to the base model (no adapter). */}
        {mergedCheckpoints.length > 0 && (
          <div className="mt-6 w-full max-w-md">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-TT-purple-accent" />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                Fine-tuned weights
              </span>
            </div>
            <Select
              value={selectedCheckpoint}
              onValueChange={setSelectedCheckpoint}
              disabled={isDeployDisabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Use base model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BASE_MODEL_VALUE}>
                  Base model (no adapter)
                </SelectItem>
                {mergedCheckpoints.map((ckpt) => (
                  <SelectItem key={ckpt.path} value={ckpt.path}>
                    {ckpt.checkpoint_id || ckpt.merge_id}
                    {ckpt.source_job_id
                      ? ` · job ${ckpt.source_job_id.slice(0, 6)}`
                      : ""}
                    {ckpt.created_at
                      ? ` · ${formatTrainingTimestamp(ckpt.created_at)}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              Deploy the base model, or a checkpoint promoted from a training job.
            </p>
          </div>
        )}
      </div>
      <StepperFormActions removeDynamicSteps={() => { }} />
    </>
  );
}
