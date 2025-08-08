// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { RefreshCw, Network, Image as ImageIcon, FileText } from "lucide-react";
import ColumnsMenu from "./ColumnsMenu.tsx";
import type { ColumnVisibilityMap } from "../../types/models";
import { Spinner } from "../ui/spinner";

interface Props {
  tableId: string;
  visibleMap: ColumnVisibilityMap;
  onToggle: (key: keyof ColumnVisibilityMap, visible: boolean) => void;
  onPreset: (preset: "Minimal" | "Default" | "Full") => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export default function ModelsToolbar({
  tableId,
  visibleMap,
  onToggle,
  onPreset,
  isRefreshing,
  onRefresh,
}: Props): JSX.Element {
  const { containerId, image, ports } = visibleMap;
  return (
    <div className="flex items-center gap-4">
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        className="flex items-center gap-2 border-TT-purple/30 hover:border-TT-purple-accent hover:bg-TT-purple-tint2/20 dark:hover:bg-TT-purple-shade/20 hover:shadow-lg hover:shadow-TT-purple/20 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
        title="Refresh health status for all models"
        disabled={isRefreshing}
      >
        {isRefreshing ? (
          <Spinner className="w-4 h-4" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        Refresh Health
      </Button>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            Toggle Columns:
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            (click to show/hide)
          </span>
        </div>
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={containerId ? "default" : "outline"}
                  className="cursor-pointer hover:bg-TT-purple-tint2/30 dark:hover:bg-TT-purple-shade/30 transition-all duration-200 hover:scale-105 hover:shadow-md border-TT-purple/30 hover:border-TT-purple-accent"
                  onClick={() => onToggle("containerId", !containerId)}
                >
                  <FileText className="w-3 h-3 mr-1" />
                  Container Logs
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Show/hide container logs column</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={image ? "default" : "outline"}
                  className="cursor-pointer hover:bg-TT-purple-tint2/30 dark:hover:bg-TT-purple-shade/30 transition-all duration-200 hover:scale-105 hover:shadow-md border-TT-purple/30 hover:border-TT-purple-accent"
                  onClick={() => onToggle("image", !image)}
                >
                  <ImageIcon className="w-3 h-3 mr-1" />
                  Docker Image
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Show/hide Docker image column</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={ports ? "default" : "outline"}
                  className="cursor-pointer hover:bg-TT-purple-tint2/30 dark:hover:bg-TT-purple-shade/30 transition-all duration-200 hover:scale-105 hover:shadow-md border-TT-purple/30 hover:border-TT-purple-accent"
                  onClick={() => onToggle("ports", !ports)}
                >
                  <Network className="w-3 h-3 mr-1" />
                  Port Mappings
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Show/hide port mappings column</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <ColumnsMenu
        tableId={tableId}
        value={visibleMap}
        onChange={onToggle}
        onPreset={onPreset}
      />
    </div>
  );
}
