// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";

// The effective HF Xet state is env-derived and static for the backend's
// lifetime, so cache the first successful fetch module-wide and share it across
// every badge mount instead of re-fetching per component.
let cached: boolean | null = null;
let inflight: Promise<boolean | null> | null = null;

async function fetchXetEnabled(): Promise<boolean | null> {
  try {
    const res = await fetch("/docker-api/hf-download-config/");
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.xet_enabled === "boolean" ? data.xet_enabled : null;
  } catch {
    return null;
  }
}

/**
 * Returns whether HuggingFace's Xet CDN is enabled for deployed model-weight
 * downloads. `null` while unknown (loading or the request failed) so callers can
 * render nothing rather than guess.
 */
export function useHfXetStatus(): boolean | null {
  const [xetEnabled, setXetEnabled] = useState<boolean | null>(cached);

  useEffect(() => {
    if (cached !== null) {
      setXetEnabled(cached);
      return;
    }
    let active = true;
    if (!inflight) inflight = fetchXetEnabled();
    inflight.then((val) => {
      if (val !== null) cached = val;
      if (active) setXetEnabled(val);
    });
    return () => {
      active = false;
    };
  }, []);

  return xetEnabled;
}
