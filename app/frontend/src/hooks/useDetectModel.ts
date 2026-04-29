// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";

export interface DetectedModelInfo {
  hf_model_id?: string;
  model_type?: string;
  port?: number;
  source?: "logs" | "api" | "paste";
}

export function useDetectModel(containerId: string) {
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedModelInfo | null>(null);

  useEffect(() => {
    if (!containerId) {
      setDetected(null);
      return;
    }
    setDetecting(true);
    setDetected(null);
    const controller = new AbortController();
    fetch(`/docker-api/detect-model/${containerId}/`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: DetectedModelInfo & { error?: string }) => {
        if (!data.error && Object.keys(data).length > 0) setDetected(data);
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
    return () => controller.abort();
  }, [containerId]);

  return { detecting, detected, setDetected };
}
