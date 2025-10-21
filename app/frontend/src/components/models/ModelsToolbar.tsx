// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { JSX } from "react";
import SettingsMenu from "./SettingsMenu";
import type { ColumnVisibilityMap } from "../../types/models";

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
}: Props): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      {/* This component now only renders the Settings dropdown, per redesign */}
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
