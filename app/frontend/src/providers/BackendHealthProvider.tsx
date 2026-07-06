// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackendHealthContext,
  type BackendStatus,
} from "../contexts/BackendHealthContext";
import { BackendDisconnectedOverlay } from "../components/BackendDisconnectedOverlay";

// Poll the backend's bare liveness endpoint. It returns an empty 200 and does no
// work, so it is cheap to hit frequently.
const HEALTH_URL = "/up/";
// How long to wait for a response before treating the poll as a failure, so a
// hung/half-open connection (e.g. a dropped SSH tunnel) can't stall detection.
const REQUEST_TIMEOUT_MS = 5_000;
// Poll cadence: relaxed while healthy, snappier once a failure is seen so both
// disconnect and recovery are detected quickly.
const HEALTHY_INTERVAL_MS = 5_000;
const UNHEALTHY_INTERVAL_MS = 3_000;
// Require a couple of consecutive failures before showing the overlay so a
// single transient blip doesn't flash it.
const FAILURE_THRESHOLD = 2;

export const BackendHealthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Optimistic default: assume connected so the overlay never flashes on load.
  // The first poll confirms reachability within a poll interval.
  const [disconnected, setDisconnected] = useState(false);
  const [checking, setChecking] = useState(false);

  const failuresRef = useRef(0);
  // Mirror `disconnected` in a ref so the polling closure reads the latest value
  // without being re-created on every state change.
  const disconnectedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => Promise<void>>(async () => {});

  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const interval =
      failuresRef.current > 0 ? UNHEALTHY_INTERVAL_MS : HEALTHY_INTERVAL_MS;
    timerRef.current = setTimeout(() => pollRef.current(), interval);
  }, []);

  useEffect(() => {
    const poll = async () => {
      // Only surface the "checking" spinner while the overlay is already up.
      if (disconnectedRef.current) setChecking(true);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(HEALTH_URL, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Reachable again: clear failure count and drop the overlay.
        failuresRef.current = 0;
        if (disconnectedRef.current) {
          disconnectedRef.current = false;
          setDisconnected(false);
        }
        setChecking(false);
      } catch {
        failuresRef.current += 1;
        if (failuresRef.current >= FAILURE_THRESHOLD && !disconnectedRef.current) {
          disconnectedRef.current = true;
          setDisconnected(true);
        }
        setChecking(false);
      } finally {
        clearTimeout(timeout);
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

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pollRef.current();
  }, []);

  const status: BackendStatus = disconnected
    ? checking
      ? "checking"
      : "disconnected"
    : "connected";

  const value = useMemo(() => ({ status, retry }), [status, retry]);

  return (
    <BackendHealthContext.Provider value={value}>
      {children}
      {status !== "connected" && (
        <BackendDisconnectedOverlay status={status} onRetry={retry} />
      )}
    </BackendHealthContext.Provider>
  );
};
