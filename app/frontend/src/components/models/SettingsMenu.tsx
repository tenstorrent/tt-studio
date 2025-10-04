// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// React import not needed for modern JSX transform
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Settings } from "lucide-react";
import type { ColumnVisibilityMap } from "../../types/models";

type Density = "compact" | "normal" | "comfortable";

interface Props {
  tableId: string;
  columns: ColumnVisibilityMap;
  onToggleColumn: (key: keyof ColumnVisibilityMap, visible: boolean) => void;
  visibleCount: number;
  totalCount: number;
  density: Density;
  onDensity: (d: Density) => void;
  autoRefreshSec: number;
  onAutoRefreshSec: (sec: number) => void;
  healthRefreshSec: number;
  onHealthRefreshSec: (sec: number) => void;
  onExportVisible: () => void;
  onCopyAll: () => void;
  onPreset: (preset: "Minimal" | "Default" | "Full") => void;
  onRefreshHealthNow?: () => void;
  isRefreshing?: boolean;
}

export default function SettingsMenu({
  tableId,
  columns,
  onToggleColumn,
  visibleCount,
  totalCount,
  density,
  onDensity,
  autoRefreshSec,
  onAutoRefreshSec,
  healthRefreshSec,
  onHealthRefreshSec,
  onExportVisible,
  onCopyAll,
  onPreset,
  onRefreshHealthNow,
  isRefreshing,
}: Props): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-TT-purple/30"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold">View Options</div>
            <div className="mt-2 text-xs text-stone-500">Toggle Columns</div>
            <div className="mt-2 space-y-2">
              {Object.entries(columns).map(([key, v]) => (
                <label
                  key={`${tableId}:${key}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={v}
                    onChange={(e) =>
                      onToggleColumn(
                        key as keyof ColumnVisibilityMap,
                        e.target.checked
                      )
                    }
                    className="accent-TT-purple"
                  />
                  <span className="capitalize">{key}</span>
                </label>
              ))}
            </div>
            <div className="mt-2 text-xs text-stone-500">Columns Display</div>
            <div className="text-sm">
              {visibleCount}/{totalCount}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPreset("Minimal")}
              >
                Minimal
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPreset("Default")}
              >
                Default
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPreset("Full")}
              >
                Full
              </Button>
            </div>
            <div className="mt-4 text-xs text-stone-500">Table Density</div>
            <div className="mt-1 flex gap-2">
              {(["compact", "normal", "comfortable"] as Density[]).map((d) => (
                <Button
                  key={d}
                  variant={density === d ? "default" : "outline"}
                  size="sm"
                  onClick={() => onDensity(d)}
                >
                  {d}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold">Refresh Settings</div>
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRefreshHealthNow?.()}
                disabled={isRefreshing}
                className="w-full"
              >
                {isRefreshing ? "Refreshing…" : "Refresh health now"}
              </Button>
            </div>
            <div className="mt-2 text-xs text-stone-500">
              Auto-refresh interval (seconds)
            </div>
            <input
              type="number"
              min={0}
              step={5}
              value={autoRefreshSec}
              onChange={(e) => onAutoRefreshSec(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-stone-300 bg-transparent p-2 text-sm outline-none focus:border-TT-purple-accent"
            />
            <div className="mt-2 text-xs text-stone-500">
              Health check frequency (seconds)
            </div>
            <input
              type="number"
              min={0}
              step={5}
              value={healthRefreshSec}
              onChange={(e) => onHealthRefreshSec(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-stone-300 bg-transparent p-2 text-sm outline-none focus:border-TT-purple-accent"
            />
          </div>

          <div>
            <div className="text-sm font-semibold">Export/Import</div>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={onExportVisible}>
                Export table data
              </Button>
              <Button variant="outline" size="sm" onClick={onCopyAll}>
                Copy all visible info
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
