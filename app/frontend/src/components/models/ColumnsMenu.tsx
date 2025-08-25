// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo } from "react";
import type { ColumnVisibilityMap } from "../../types/models";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface Props {
  value: ColumnVisibilityMap;
  onChange: (key: keyof ColumnVisibilityMap, visible: boolean) => void;
  onPreset: (preset: "Minimal" | "Default" | "Full") => void;
}

export default function ColumnsMenu({
  value,
  onChange,
  onPreset,
}: Props): JSX.Element {
  const visibleCount = useMemo(
    () => Object.values(value).filter(Boolean).length,
    [value]
  );
  const totalCount = useMemo(() => Object.keys(value).length, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-TT-purple/30"
        >
          Columns
          <Badge variant="outline">
            {visibleCount}/{totalCount}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="space-y-3">
          <div className="text-sm font-medium">Presets</div>
          <div className="flex gap-2">
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
          <div className="h-px bg-stone-200 dark:bg-stone-800" />
          <div className="space-y-2">
            {Object.entries(value).map(([key, v]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v}
                  onChange={(e) =>
                    onChange(key as keyof ColumnVisibilityMap, e.target.checked)
                  }
                  className="accent-TT-purple"
                />
                <span className="capitalize">{key}</span>
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
