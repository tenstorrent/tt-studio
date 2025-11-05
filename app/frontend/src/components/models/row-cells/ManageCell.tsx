// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { EnhancedButton as Button } from "../../ui/enhanced-button";
import {
  FileCode2,
  Trash2,
  ScrollText,
  MessageSquareText,
  Image as ImageIcon,
  Crosshair,
  Mic,
} from "lucide-react";
import type { HealthStatus } from "../../../types/models";
import {
  getModelTypeFromName,
  ModelType,
} from "../../../api/modelsDeployedApis";

interface Props {
  id: string;
  name?: string;
  image?: string;
  health?: HealthStatus;
  onDelete: (id: string) => void;
  onRedeploy: (image?: string) => void;
  onNavigateToModel: (id: string, name: string, navigate?: any) => void;
  onOpenApi: (id: string) => void;
}

export default React.memo(function ManageCell({
  id,
  name,
  image: _image,
  health,
  onDelete,
  onRedeploy: _onRedeploy,
  onNavigateToModel,
  onOpenApi,
}: Props) {
  const baseBtn =
    "group/btn rounded-full border pl-4 pr-6 py-2 text-sm font-medium transition-all duration-200 inline-flex items-center gap-2 hover:ring-1 hover:ring-current min-h-[36px] leading-none";
  const blueBtn =
    "!border-sky-400/70 !text-sky-300 !bg-sky-500/10 hover:!bg-sky-500/20";
  const amberBtn =
    "!border-amber-400/70 !text-amber-300 !bg-amber-500/10 hover:!bg-amber-500/20";
  const dangerBtn =
    "!border-red-400/70 !text-red-300 !bg-red-600/20 hover:!bg-red-600/30 shadow-[0_8px_24px_rgba(255,0,0,0.15)]";

  const modelType = getModelTypeFromName(name ?? "");
  const openLabel =
    modelType === ModelType.ImageGeneration
      ? "Image Gen"
      : modelType === ModelType.ObjectDetectionModel
        ? "Object Detect"
        : modelType === ModelType.SpeechRecognitionModel
          ? "Speech"
          : "Chat";
  const OpenIcon =
    modelType === ModelType.ImageGeneration
      ? ImageIcon
      : modelType === ModelType.ObjectDetectionModel
        ? Crosshair
        : modelType === ModelType.SpeechRecognitionModel
          ? Mic
          : MessageSquareText;

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
        className={`${baseBtn} !border-TT-purple-accent/60 !text-TT-purple-accent/90`}
      >
        Logs
      </Button>
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

      {/* Hover tier: admin actions */}
      {/* Hover tier removed per redesign; health refresh is now in Settings */}
    </div>
  );
});
