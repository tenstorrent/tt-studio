// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";

export interface DetectedModelInfo {
  hf_model_id?: string;
  model_type?: string;
  port?: number;
  source?: "container" | "api" | "logs";
}

// Probe a discovered container's logs (and, if reachable, its live /v1/models
// endpoint) to auto-detect the model it's serving. Used to prefill the register
// form so the user isn't hand-entering values the container already knows.
export function useDetectModel(containerId: string) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedModelInfo | null>(null);

  useEffect(() => {
    if (!containerId) {
      setDetected(null);
      return;
    }
    let cancelled = false;
    setDetecting(true);
    setDetected(null);
    const controller = new AbortController();
    fetch(`/docker-api/detect-model/${containerId}/`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: DetectedModelInfo & { error?: string }) => {
        if (!cancelled && !data.error && Object.keys(data).length > 0) setDetected(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDetecting(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [containerId]);

  return { detecting, detected, setDetected };
}
