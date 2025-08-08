// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useMemo } from "react";
import { Button } from "../../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import {
  Trash2,
  RefreshCw,
  Code,
  MessageSquare,
  Image as ImageIcon,
  Eye,
  AudioLines,
  AlertCircle,
} from "lucide-react";
import {
  getModelTypeFromName,
  ModelType,
} from "../../../api/modelsDeployedApis";
import type { HealthStatus } from "../../../types/models";

interface Props {
  id: string;
  name?: string;
  image?: string;
  health?: HealthStatus;
  onDelete: (id: string) => void;
  onRedeploy: (image?: string) => void;
  onNavigateToModel: (id: string, name: string) => void;
  onOpenApi: (id: string) => void;
}

function isLLaMAModel(modelName: string) {
  return modelName.toLowerCase().includes("llama");
}

function getModelIcon(modelName: string) {
  const modelType = getModelTypeFromName(modelName);
  switch (modelType) {
    case ModelType.ChatModel:
      return <MessageSquare className="w-4 h-4 mr-2" />;
    case ModelType.ImageGeneration:
      return <ImageIcon className="w-4 h-4 mr-2" />;
    case ModelType.ObjectDetectionModel:
      return <Eye className="w-4 h-4 mr-2" />;
    case ModelType.SpeechRecognitionModel:
      return <AudioLines className="w-4 h-4 mr-2" />;
    default:
      return <MessageSquare className="w-4 h-4 mr-2" />;
  }
}

function getModelTypeLabel(modelName: string) {
  const modelType = getModelTypeFromName(modelName);
  switch (modelType) {
    case ModelType.ChatModel:
      return "Chat";
    case ModelType.ImageGeneration:
      return "Image Generation";
    case ModelType.ObjectDetectionModel:
      return "Object Detection";
    case ModelType.SpeechRecognitionModel:
      return "Speech Recognition";
    default:
      return "Chat";
  }
}

export default React.memo(function ManageCell({
  id,
  name,
  image,
  health,
  onDelete,
  onRedeploy,
  onNavigateToModel,
  onOpenApi,
}: Props) {
  const healthDisabled = (health ?? "unknown") !== "healthy";

  const tooltipText = useMemo(() => {
    const typeLabel = getModelTypeLabel(name || "");
    if (!name) return `Open ${typeLabel} for this model`;
    return `Open ${typeLabel} for this model`;
  }, [name]);

  return (
    <div className="flex gap-2 justify-center">
      <Button
        onClick={() => onDelete(id)}
        variant="destructive"
        size="sm"
        className="h-10 px-4 rounded-xl font-medium gap-2 shadow-sm hover:shadow-md hover:shadow-red-200/50 dark:hover:shadow-red-900/50 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
      >
        <Trash2 className="w-4 h-4 mr-1" />
        Delete
      </Button>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => name && onNavigateToModel(id, name)}
              variant="default"
              size="sm"
              disabled={!name || healthDisabled}
              className="h-10 px-4 min-w-[120px] rounded-xl font-medium bg-TT-green-accent hover:bg-TT-green-shade text-white gap-2 shadow-sm hover:shadow-md hover:shadow-TT-green/30 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 border border-TT-green/30"
            >
              {getModelIcon(name || "")}
              {getModelTypeLabel(name || "")}
              {name && isLLaMAModel(name) && (
                <AlertCircle className="w-4 h-4 ml-2 text-yellow-600" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="bg-gray-700 text-white">
            {(health ?? "unknown") !== "healthy" ? (
              <p>Action unavailable: Model health is not healthy.</p>
            ) : name && isLLaMAModel(name) ? (
              <p>
                Warning: First-time inference may take up to an hour for model
                weights to be downloaded. Subsequent runs may take 5-7 min
                minutes.
              </p>
            ) : (
              <p>{tooltipText}</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => onOpenApi(id)}
              variant="outline"
              size="sm"
              className="h-10 px-4 min-w-[120px] rounded-xl font-medium flex items-center gap-2 border-TT-blue-accent/40 bg-TT-blue-tint2/40 text-TT-blue-accent dark:bg-TT-blue-accent/25 dark:text-TT-blue-tint2 hover:bg-TT-blue-tint2/60 dark:hover:bg-TT-blue-accent/40 hover:border-TT-blue-accent shadow-sm hover:shadow-md hover:shadow-TT-blue/25 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Code className="w-3 h-3" />
              API
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>View API information and test endpoints</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
});
