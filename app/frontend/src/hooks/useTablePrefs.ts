// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo, useState } from "react";
import { safeGetItem, safeSetItem } from "../lib/storage";

export type TableDensity = "compact" | "normal" | "comfortable";

export interface TablePrefs {
  density: TableDensity;
  autoRefreshSec: number; // 0 = off
  healthRefreshSec: number; // 0 = off
}

const DEFAULT_PREFS: TablePrefs = {
  density: "normal",
  autoRefreshSec: 0,
  healthRefreshSec: 0,
};

export function useTablePrefs(
  tableId: string,
  defaults: Partial<TablePrefs> = {}
) {
  const storageKey = `table:${tableId}:prefs`;
  const initial = useMemo(
    () =>
      safeGetItem<TablePrefs>(storageKey, { ...DEFAULT_PREFS, ...defaults }),
    [storageKey, defaults]
  );
  const [prefs, setPrefs] = useState<TablePrefs>(initial);

  const setDensity = useCallback(
    (density: TableDensity) => {
      setPrefs((prev) => {
        const next = { ...prev, density };
        safeSetItem(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const setAutoRefreshSec = useCallback(
    (sec: number) => {
      setPrefs((prev) => {
        const next = { ...prev, autoRefreshSec: sec };
        safeSetItem(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const setHealthRefreshSec = useCallback(
    (sec: number) => {
      setPrefs((prev) => {
        const next = { ...prev, healthRefreshSec: sec };
        safeSetItem(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  return {
    prefs,
    setDensity,
    setAutoRefreshSec,
    setHealthRefreshSec,
  } as const;
}
