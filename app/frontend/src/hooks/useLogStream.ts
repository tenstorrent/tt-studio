// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";

type Filters = {
  showHealthChecks: boolean;
  showMetrics: boolean;
  showErrors: boolean;
};

export function useLogStream(
  open: boolean,
  containerId: string | null,
  reloadKey: number = 0
) {
  const [logs, setLogs] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    showHealthChecks: true,
    showMetrics: true,
    showErrors: true,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutIdRef = useRef<number | null>(null);

  const resetState = useCallback(() => {
    setLogs([]);
    setEvents([]);
    setMetrics({});
    setError(null);
  }, []);

  useEffect(() => {
    if (!open || !containerId) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      resetState();
      setIsLoading(false);
      return;
    }

    // Avoid resetting visible UI when switching tabs; only when opening or id changes
    resetState();
    setIsLoading(true);

    const endpoint = `/models-api/logs/${containerId}/`;

    timeoutIdRef.current = window.setTimeout(() => {
      if (isLoading) {
        setError("Failed to connect to log stream. Please try again.");
        setIsLoading(false);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      }
    }, 8000);

    try {
      eventSourceRef.current = new EventSource(endpoint, {
        withCredentials: true,
      });

      const connectionEstablished = () => {
        setIsLoading(false);
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
      };

      eventSourceRef.current.onopen = () => {
        connectionEstablished();
      };

      eventSourceRef.current.onmessage = (event) => {
        connectionEstablished();
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log") {
            setLogs((prev) => [...prev, data.message]);
          } else if (data.type === "event") {
            setEvents((prev) => [...prev, data.message]);
          } else if (data.type === "metric") {
            setMetrics((prev) => ({ ...prev, [data.name]: data.value }));
          }
        } catch {
          setLogs((prev) => [...prev, event.data]);
        }
      };

      eventSourceRef.current.onerror = () => {
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        if (isLoading) {
          setError(
            "Failed to connect to log stream. The container may have stopped."
          );
        } else {
          setError(
            "Connection to log stream lost. The container may have stopped."
          );
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      };
    } catch {
      setError("Failed to create log stream connection. Please try again.");
      setIsLoading(false);
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    }

    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [open, containerId, resetState, reloadKey]);

  const filterLog = useCallback(
    (logEntry: string) => {
      if (!filters.showHealthChecks && logEntry.includes("GET /health"))
        return false;
      if (!filters.showMetrics && logEntry.includes("metrics.py")) return false;
      if (
        !filters.showErrors &&
        (logEntry.includes(" 500 ") ||
          logEntry.includes("ERROR") ||
          logEntry.includes("timeout"))
      )
        return false;
      return true;
    },
    [filters]
  );

  return {
    logs,
    events,
    metrics,
    error,
    isLoading,
    filters,
    setFilters,
    filterLog,
  } as const;
}
