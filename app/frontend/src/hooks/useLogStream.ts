// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

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
  const isLoadingRef = useRef(false);

  const setLoading = (val: boolean) => {
    isLoadingRef.current = val;
    setIsLoading(val);
  };

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
      setLoading(false);
      return;
    }

    // Avoid resetting visible UI when switching tabs; only when opening or id changes
    resetState();
    setLoading(true);

    const endpoint = `/models-api/logs/${containerId}/`;

    timeoutIdRef.current = window.setTimeout(() => {
      if (isLoadingRef.current) {
        setError("Failed to connect to log stream. Please try again.");
        setLoading(false);
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
        setLoading(false);
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
          const msg = data.message;
          switch (data.type) {
            case "log":
              setLogs((prev) => [...prev, msg]);
              break;
            case "event":
              setEvents((prev) => [...prev, msg]);
              break;
            case "error":
            case "warning":
              // Errors and warnings appear in both logs and events
              setLogs((prev) => [...prev, msg]);
              setEvents((prev) => [...prev, msg]);
              break;
            case "service_unavailable":
              setError(
                data.message ||
                  "The docker-control-service is not running. Start it on port 8002 and retry."
              );
              setLoading(false);
              if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              break;
            case "metric":
              setMetrics((prev) => ({ ...prev, [data.name]: data.value }));
              break;
            default:
              setLogs((prev) => [...prev, msg]);
              break;
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
        if (isLoadingRef.current) {
          setError(
            "Failed to connect to log stream. The container may have stopped."
          );
        } else {
          setError(
            "Connection to log stream lost. The container may have stopped."
          );
        }
        setLoading(false);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      };
    } catch {
      setError("Failed to create log stream connection. Please try again.");
      setLoading(false);
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
