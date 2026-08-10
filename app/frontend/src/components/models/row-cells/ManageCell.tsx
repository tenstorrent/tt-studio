// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { EnhancedButton as Button } from "../../ui/enhanced-button";
import {
  FileCode2,
  Trash2,
  ScrollText,
  MessageSquareText,
  Image as ImageIcon,
  Crosshair,
  Loader2,
  Mic,
  Volume2,
  ScanFace,
  BrainCog,
} from "lucide-react";
import type { HealthStatus } from "../../../types/models";
import {
  getModelTypeFromName,
  getModelTypeFromBackendType,
  ModelType,
} from "../../../api/modelsDeployedApis";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { useIsResetting } from "../../../hooks/useIsResetting";
import { useModels } from "../../../hooks/useModels";

interface Props {
  id: string;
  name?: string;
  image?: string;
  model_type?: string;
  health?: HealthStatus;
  isFailed?: boolean;
  onDelete: (id: string) => void;
  onRedeploy: (image?: string) => void;
  onNavigateToModel: (id: string, name: string, navigate?: any) => void;
  onOpenApi: (id: string) => void;
  deleteInProgress?: boolean;
  isCurrentlyDeleting?: boolean;
  onOpenLogs?: (id: string) => void;
}

export default React.memo(function ManageCell({
  id,
  name,
  image: _image,
  model_type,
  health,
  isFailed,
  onDelete,
  onRedeploy: _onRedeploy,
  onNavigateToModel,
  onOpenApi,
  deleteInProgress = false,
  isCurrentlyDeleting = false,
  onOpenLogs,
}: Props) {
  // A board/device reset is in progress: block destructive + log-tailing actions
  // everywhere so the user can't fight an in-flight reset.
  const isResetting = useIsResetting();
  // Stopping a container goes through docker-control-service, so while that is
  // unreachable the action cannot succeed — better to disable it and say why than
  // to let it fail. The model itself is unaffected: inference does not go through
  // that service, so Open/Chat stays enabled.
  const { controlPlaneDegraded } = useModels();
  const deleteDisabled = deleteInProgress || isResetting || controlPlaneDegraded;
  // Most specific cause first: an in-flight delete is a concrete operation the
  // user is waiting on, so it must not be shadowed by the broader outage notice.
  const deleteDisabledReason = isResetting
    ? "The board is resetting. Wait for it to finish before deleting a model."
    : deleteInProgress
      ? "A model is currently being deleted. Please wait for it to finish before starting another destructive action."
      : "The Docker control service is unreachable, so this model can't be stopped right now. The model itself is unaffected and still usable.";
  const resettingTitle = isResetting
    ? "Disabled while the board is resetting"
    : undefined;
  const baseBtn =
    "group/btn rounded-full border pl-4 pr-6 py-2 text-sm font-medium transition-all duration-200 inline-flex items-center gap-2 hover:ring-1 hover:ring-current min-h-[36px] leading-none";
  const blueBtn =
    "!border-sky-400/70 !text-sky-300 !bg-sky-500/10 hover:!bg-sky-500/20";
  const amberBtn =
    "!border-amber-400/70 !text-amber-300 !bg-amber-500/10 hover:!bg-amber-500/20";
  const dangerBtn =
    "!border-red-400/70 !text-red-300 !bg-red-600/20 hover:!bg-red-600/30 shadow-[0_8px_24px_rgba(255,0,0,0.15)]";

  const modelType = model_type
    ? getModelTypeFromBackendType(model_type)
    : getModelTypeFromName(name ?? "");
  const openLabel =
    modelType === ModelType.ImageGeneration
      ? "Image Gen"
      : modelType === ModelType.ObjectDetectionModel
        ? "Object Detect"
        : modelType === ModelType.SpeechRecognitionModel
          ? "Speech"
          : modelType === ModelType.FaceRecognitionModel
            ? "Face Rec"
            : modelType === ModelType.TTS
              ? "TTS"
              : modelType === ModelType.Training
                ? "Training Dashboard"
                : "Chat";
  const OpenIcon =
    modelType === ModelType.ImageGeneration
      ? ImageIcon
      : modelType === ModelType.ObjectDetectionModel
        ? Crosshair
        : modelType === ModelType.SpeechRecognitionModel
          ? Mic
          : modelType === ModelType.FaceRecognitionModel
            ? ScanFace
            : modelType === ModelType.TTS
              ? Volume2
              : modelType === ModelType.Training
                ? BrainCog
                : MessageSquareText;

  if (isFailed) {
    return (
      <div className="relative flex items-center justify-center gap-2 flex-wrap">
        {onOpenLogs && (
          <Button
            variant="outline"
            size="sm"
            effect="expandIcon"
            icon={ScrollText}
            iconPlacement="left"
            onClick={() => onOpenLogs(id)}
            disabled={isResetting}
            title={resettingTitle}
            className={`${baseBtn} !border-TT-purple-accent/60 !text-TT-purple-accent/90`}
          >
            Logs
          </Button>
        )}
        {isCurrentlyDeleting ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  effect="expandIcon"
                  icon={Loader2}
                  iconPlacement="right"
                  onClick={() => onDelete(id)}
                  className={`${baseBtn} ${dangerBtn} [&_svg]:animate-spin`}
                >
                  Removing…
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-sm">
                  Removal in progress. Click to view progress.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : deleteDisabled ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    variant="outline"
                    size="sm"
                    effect="expandIcon"
                    icon={Trash2}
                    iconPlacement="right"
                    onClick={() => onDelete(id)}
                    disabled
                    className={`${baseBtn} ${dangerBtn}`}
                  >
                    Remove &amp; Reset
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <p className="text-sm">
                  {deleteDisabledReason}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            variant="outline"
            size="sm"
            effect="expandIcon"
            icon={Trash2}
            iconPlacement="right"
            onClick={() => onDelete(id)}
            className={`${baseBtn} ${dangerBtn}`}
          >
            Remove &amp; Reset
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        effect="expandIcon"
        icon={FileCode2}
        iconPlacement="right"
        onClick={() => onOpenApi(id)}
        disabled={health !== "healthy"}
        className={`${baseBtn} ${blueBtn}`}
      >
        API
      </Button>
      <Button
        variant="outline"
        size="sm"
        effect="expandIcon"
        icon={OpenIcon}
        iconPlacement="left"
        onClick={() => onNavigateToModel(id, name ?? id)}
        disabled={health !== "healthy"}
        className={`${baseBtn} ${amberBtn}`}
      >
        {openLabel}
      </Button>
      <Button
        variant="outline"
        size="sm"
        effect="expandIcon"
        icon={ScrollText}
        iconPlacement="left"
        onClick={() => {
          const evt = new CustomEvent("row:logs", { detail: { id } });
          window.dispatchEvent(evt);
        }}
        disabled={isResetting}
        title={resettingTitle}
        className={`${baseBtn} !border-TT-purple-accent/60 !text-TT-purple-accent/90`}
      >
        Logs
      </Button>
      {isCurrentlyDeleting ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                effect="expandIcon"
                icon={Loader2}
                iconPlacement="right"
                onClick={() => onDelete(id)}
                className={`${baseBtn} ${dangerBtn} [&_svg]:animate-spin`}
              >
                Deleting…
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">
                Deletion in progress. Click to view progress.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : deleteDisabled ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  variant="outline"
                  size="sm"
                  effect="expandIcon"
                  icon={Trash2}
                  iconPlacement="right"
                  onClick={() => onDelete(id)}
                  disabled
                  className={`${baseBtn} ${dangerBtn}`}
                >
                  Delete
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">
                {deleteDisabledReason}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Button
          variant="outline"
          size="sm"
          effect="expandIcon"
          icon={Trash2}
          iconPlacement="right"
          onClick={() => onDelete(id)}
          className={`${baseBtn} ${dangerBtn}`}
        >
          Delete
        </Button>
      )}

      {/* Hover tier: admin actions */}
      {/* Hover tier removed per redesign; health refresh is now in Settings */}
    </div>
  );
});
