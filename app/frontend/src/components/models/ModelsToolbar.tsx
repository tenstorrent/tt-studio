// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import SettingsMenu from "./SettingsMenu";
import type { ColumnVisibilityMap } from "../../types/models";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { HelpCircle } from "lucide-react";

interface Props {
  tableId: string;
  visibleMap: ColumnVisibilityMap;
  onToggle: (key: keyof ColumnVisibilityMap, visible: boolean) => void;
  onPreset: (preset: "Minimal" | "Default" | "Full") => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  density?: "compact" | "normal" | "comfortable";
  onDensity?: (d: "compact" | "normal" | "comfortable") => void;
  autoRefreshSec?: number;
  onAutoRefreshSec?: (sec: number) => void;
  healthRefreshSec?: number;
  onHealthRefreshSec?: (sec: number) => void;
  onExportVisible?: () => void;
  onCopyAll?: () => void;
  visibleCount?: number;
  totalCount?: number;
  onRefreshHealthNow?: () => void;
  onOpenGuide?: () => void;
}

export default function ModelsToolbar({
  tableId,
  visibleMap,
  onToggle,
  onPreset,
  isRefreshing,
  onRefresh: _onRefresh, // Marked as intentionally unused for now
  density = "normal",
  onDensity,
  autoRefreshSec = 0,
  onAutoRefreshSec,
  healthRefreshSec = 0,
  onHealthRefreshSec,
  onExportVisible,
  onCopyAll,
  visibleCount,
  totalCount,
  onRefreshHealthNow,
  onOpenGuide,
}: Props): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {onOpenGuide && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={onOpenGuide}
                className="w-8 h-8 text-stone-500 hover:text-stone-300"
                aria-label="Getting started guide"
              >
                <HelpCircle className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Getting started guide</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <SettingsMenu
        tableId={tableId}
        columns={visibleMap}
        onToggleColumn={onToggle}
        visibleCount={
          visibleCount ?? Object.values(visibleMap).filter(Boolean).length
        }
        totalCount={totalCount ?? Object.keys(visibleMap).length}
        density={density}
        onDensity={(d) => onDensity?.(d)}
        autoRefreshSec={autoRefreshSec}
        onAutoRefreshSec={(sec) => onAutoRefreshSec?.(sec)}
        healthRefreshSec={healthRefreshSec}
        onHealthRefreshSec={(sec) => onHealthRefreshSec?.(sec)}
        onExportVisible={() => onExportVisible?.()}
        onCopyAll={() => onCopyAll?.()}
        onPreset={onPreset}
        onRefreshHealthNow={onRefreshHealthNow}
        isRefreshing={isRefreshing}
      />
    </div>
  );
}
