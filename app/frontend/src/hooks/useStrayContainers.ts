// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { discoverContainers } from "../api/modelsDeployedApis";

// Polls for "stray" containers — running containers that aren't TT Studio
// infrastructure and aren't yet registered as deployments (i.e. registration
// candidates). Used to surface the Register Model nav entry only when there's
// actually something to register.
export function useStrayContainers(pollMs = 7000): { count: number; hasStray: boolean } {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const containers = await discoverContainers();
        if (!cancelled) setCount(containers.length);
      } catch {
        if (!cancelled) setCount(0);
      }
    };
    check();
    const id = window.setInterval(check, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return { count, hasStray: count > 0 };
}
