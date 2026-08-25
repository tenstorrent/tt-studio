// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { DeploymentProgressData } from "../hooks/useActiveDeployments";

// Mirrors DeploymentProgress's adaptive three-segment bar (image pull → weight download → container start).
export function compactPercent(
  p: DeploymentProgressData | null,
  completed: boolean,
  hadImagePull: boolean
): number {
  if (completed) return 100;
  if (!p) return 0;
  const isPull = p.stage === "pulling_image";
  const hasPull = isPull || hadImagePull;
  const [pullLo, pullHi] = hasPull ? [0, 25] : [0, 0];
  const [dlLo, dlHi] = hasPull ? [25, 95] : [0, 95];
  const [startLo, startHi] = [95, 99];
  const frac =
    p.total_bytes && p.downloaded_bytes != null
      ? Math.min(1, Math.max(0, p.downloaded_bytes / p.total_bytes))
      : 0;
  const lerp = (lo: number, hi: number, f: number) =>
    lo + (hi - lo) * Math.min(1, Math.max(0, f));
  const containerStartStages = new Set([
    "image_ready", "container_setup", "container_started", "network_setup", "finalizing", "complete",
  ]);
  if (isPull) return Math.round(lerp(pullLo, pullHi, frac));
  if (p.stage === "model_preparation")
    return Math.round(lerp(dlLo, dlHi, p.weights_cached ? 1 : frac));
  if (containerStartStages.has(p.stage))
    return Math.round(lerp(startLo, startHi, (p.progress ?? 0) / 100));
  return Math.round(hasPull ? pullLo : dlLo);
}
