// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo, useRef, useState } from "react";
import type { HealthRefsMap } from "../types/models";
import type { HealthBadgeRef } from "../components/HealthBadge";
import { debounce } from "../lib/debounce";

export function useHealthRefresh() {
  const refs = useRef<HealthRefsMap>(new Map());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const register = useCallback((id: string, node: HealthBadgeRef | null) => {
    if (node) {
      refs.current.set(id, node);
    } else {
      refs.current.delete(id);
    }
  }, []);

  const runRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const tasks: Array<Promise<void>> = [];
      refs.current.forEach((ref) => {
        if (ref && typeof ref.refreshHealth === "function") {
          tasks.push(ref.refreshHealth());
        }
      });
      await Promise.all(tasks);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const refreshAllHealth = useMemo(
    () => debounce(runRefresh, 300),
    [runRefresh]
  );

  return {
    isRefreshing,
    refreshAllHealth,
    register,
    refsMap: refs.current,
  } as const;
}

