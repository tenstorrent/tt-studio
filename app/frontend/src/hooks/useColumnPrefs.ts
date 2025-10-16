// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo, useState } from "react";
import { safeGetItem, safeSetItem } from "../lib/storage";
import type { ColumnVisibilityMap } from "../types/models";

export type ColumnKey = keyof ColumnVisibilityMap;

export type ColumnPreset = "Minimal" | "Default" | "Full";

const PRESETS: Record<ColumnPreset, ColumnVisibilityMap> = {
  Minimal: { containerId: false, image: false, ports: false },
  Default: { containerId: true, image: false, ports: true },
  Full: { containerId: true, image: true, ports: true },
};

export function useColumnPrefs(
  tableId: string,
  defaults: ColumnVisibilityMap = PRESETS.Default
) {
  const storageKey = `table:${tableId}:columns`;
  const initial = useMemo(
    () => safeGetItem<ColumnVisibilityMap>(storageKey, defaults),
    [storageKey]
  );
  const [value, setValue] = useState<ColumnVisibilityMap>(initial);

  const setKey = useCallback(
    (key: ColumnKey, visible: boolean) => {
      setValue((prev) => {
        const next = { ...prev, [key]: visible };
        safeSetItem(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const setPreset = useCallback(
    (preset: ColumnPreset) => {
      const next = PRESETS[preset];
      setValue(next);
      safeSetItem(storageKey, next);
    },
    [storageKey]
  );

  const reset = useCallback(() => {
    setValue(defaults);
    safeSetItem(storageKey, defaults);
  }, [defaults, storageKey]);

  const visibleCount = (Object.keys(value) as ColumnKey[]).filter(
    (k) => value[k]
  ).length;
  const totalCount = (Object.keys(value) as ColumnKey[]).length;

  return {
    value,
    setKey,
    setPreset,
    reset,
    presets: PRESETS,
    visibleCount,
    totalCount,
  } as const;
}
