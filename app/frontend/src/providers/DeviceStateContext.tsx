// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  DeviceStateContext,
  type DeviceStateData,
} from "../contexts/DeviceStateContext";

/**
 * Adaptive poll intervals by device state.
 * Fast polling during recovery states so the UI updates promptly.
 */
const POLL_INTERVALS: Record<string, number> = {
  HEALTHY: 30_000,
  BAD_STATE: 5_000,
  RESETTING: 2_000,
  NOT_PRESENT: 30_000,
  UNKNOWN: 10_000,
};

export const DeviceStateProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [deviceState, setDeviceState] = useState<DeviceStateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Store the current state in a ref so the scheduled callback always reads
  // the latest value without creating stale closures.
  const stateRef = useRef<string>("UNKNOWN");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // pollRef lets us call poll() from the refresh callback without circular deps.
  const pollRef = useRef<() => Promise<void>>(async () => {});

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const interval = POLL_INTERVALS[stateRef.current] ?? 10_000;
    timerRef.current = setTimeout(() => pollRef.current(), interval);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const response = await fetch("/board-api/device-state/");
        if (!response.ok)
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const data: DeviceStateData = await response.json();
        stateRef.current = data.state;
        setDeviceState(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
        scheduleNext();
      }
    };

    pollRef.current = poll;
    poll();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pollRef.current();
  }, []);

  return (
    <DeviceStateContext.Provider value={{ deviceState, loading, error, refresh }}>
      {children}
    </DeviceStateContext.Provider>
  );
};
