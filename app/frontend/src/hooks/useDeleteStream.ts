// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeleteStep } from "../components/models/DeleteModelDialog";

export type DeleteStreamStatus = "idle" | "running" | "success" | "partial" | "error";

export interface StepLogs {
  deleting: string[];
  resetting: string[];
}

export function useDeleteStream() {
  const [stepLogs, setStepLogs] = useState<StepLogs>({ deleting: [], resetting: [] });
  const [step, setStep] = useState<DeleteStep>(null);
  const [status, setStatus] = useState<DeleteStreamStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const statusRef = useRef<DeleteStreamStatus>("idle");

  const updateStatus = (next: DeleteStreamStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const appendLog = (logStep: string, message: string) => {
    const key = logStep === "resetting" ? "resetting" : "deleting";
    setStepLogs((prev) => ({ ...prev, [key]: [...prev[key], message] }));
  };

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setStepLogs({ deleting: [], resetting: [] });
    setStep(null);
    updateStatus("idle");
    setErrorMessage(null);
  }, [cleanup]);

  const start = useCallback(
    (containerId: string) => {
      cleanup();
      setStepLogs({ deleting: [], resetting: [] });
      setStep("deleting");
      updateStatus("running");
      setErrorMessage(null);

      const endpoint = `/docker-api/stop/stream/${containerId}/`;

      timeoutRef.current = window.setTimeout(() => {
        if (statusRef.current === "running") {
          setErrorMessage("Deletion timed out — the backend may still be processing.");
          updateStatus("error");
          cleanup();
        }
      }, 180_000);

      try {
        const es = new EventSource(endpoint, { withCredentials: true });
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            switch (data.type) {
              case "step":
                setStep(data.step as DeleteStep);
                break;
              case "log":
                appendLog(data.step ?? "deleting", data.message);
                break;
              case "complete":
                updateStatus(
                  data.status === "success"
                    ? "success"
                    : data.status === "partial"
                      ? "partial"
                      : "error",
                );
                if (data.status !== "success") {
                  setErrorMessage(data.message);
                }
                cleanup();
                break;
              default:
                if (data.message) {
                  appendLog(data.step ?? "deleting", data.message);
                }
                break;
            }
          } catch {
            appendLog("deleting", event.data);
          }
        };

        es.onerror = () => {
          if (statusRef.current === "running") {
            setErrorMessage("Connection to deletion stream lost.");
            updateStatus("error");
          }
          cleanup();
        };
      } catch {
        setErrorMessage("Failed to connect to deletion stream.");
        updateStatus("error");
      }
    },
    [cleanup],
  );

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return { stepLogs, step, status, errorMessage, start, reset } as const;
}
