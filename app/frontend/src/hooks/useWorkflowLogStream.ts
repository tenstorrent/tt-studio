// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";

export function useWorkflowLogStream(
  open: boolean,
  deploymentId: number | null
) {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutIdRef = useRef<number | null>(null);

  const resetState = useCallback(() => {
    setLogs([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open || !deploymentId) {
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

    resetState();
    setIsLoading(true);

    const endpoint = `/docker-api/workflow-logs/${deploymentId}/`;

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
          } else if (data.type === "complete") {
            // End of log file reached
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
          } else if (data.type === "error") {
            setError(data.message);
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
              eventSourceRef.current = null;
            }
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
            "Failed to connect to log stream. The log file may not be available."
          );
        } else {
          setError(
            "Connection to log stream lost. The log file may have been removed."
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
  }, [open, deploymentId, resetState]);

  return {
    logs,
    error,
    isLoading,
  } as const;
}

