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
  const clamp01 = (f: number) => Math.min(1, Math.max(0, f));
  // Prefer bytes; fall back to the `hf download` file counter. Byte totals are absent
  // whenever the weights monitor can't resolve the repo size, and with no fallback the
  // download segment stayed pinned at its floor for the whole cold download.
  const byteFrac =
    p.total_bytes && p.downloaded_bytes != null
      ? clamp01(p.downloaded_bytes / p.total_bytes)
      : null;
  const fileFrac =
    p.weights_files_total && p.weights_files_done != null
      ? clamp01(p.weights_files_done / p.weights_files_total)
      : null;
  const frac = byteFrac ?? fileFrac ?? 0;
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

/** Decimal (1000-based) byte formatting, to match the sizes HuggingFace reports. */
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let u = 0;
  while (value >= 1000 && u < units.length - 1) {
    value /= 1000;
    u += 1;
  }
  const decimals = value >= 100 || u === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[u]}`;
}

/** Human-readable remaining time; avoids noisy seconds when minutes or hours fit better. */
export function formatEtaRemaining(eta?: number | null): string | null {
  if (eta === undefined || eta === null || !Number.isFinite(eta) || eta < 0) return null;
  if (eta > 86400 * 2) return "More than 2 days left";
  if (eta < 50) return `~${Math.max(1, Math.round(eta))} s left`;
  if (eta < 90) return "~1 min left";
  if (eta < 3600) {
    const mins = Math.max(1, Math.round(eta / 60));
    return `~${mins} min left`;
  }
  const hours = Math.floor(eta / 3600);
  const mins = Math.round((eta % 3600) / 60);
  if (mins === 0) return `~${hours} h left`;
  return `~${hours} h ${mins} min left`;
}

export function formatSpeed(bytesPerSecond?: number | null): string | null {
  if (bytesPerSecond === undefined || bytesPerSecond === null || bytesPerSecond <= 0) return null;
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** The transfer facts as discrete parts — e.g. ["12.6 / 55.6 GB", "117 MB/s",
 *  "~6 min left"] — omitting whatever the backend hasn't reported yet.
 *
 *  Returned as parts rather than a joined string so callers can render the separator
 *  as its own aria-hidden element, matching DeploymentProgress. A literal "·" inside
 *  the text is announced as "middle dot" by screen readers. */
export function transferDetailParts(p: DeploymentProgressData | null): string[] {
  if (!p) return [];
  const total = p.total_bytes && p.total_bytes > 0 ? p.total_bytes : null;
  const done = typeof p.downloaded_bytes === "number" ? p.downloaded_bytes : null;
  const parts: string[] = [];
  if (done !== null && total !== null) {
    // Share the unit across both figures ("12.6 / 55.6 GB") rather than formatting
    // each independently, which can render two different units side by side.
    const totalText = formatBytes(total);
    const [totalValue, unit] = totalText.split(" ");
    const scale = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15 }[unit] ?? 1;
    // Match the total's precision so the pair reads evenly ("0.0 / 55.6 GB", not
    // "0.00 / 55.6 GB") — the two figures are only comparable at a glance if their
    // decimals line up.
    const decimals = (totalValue.split(".")[1] ?? "").length;
    parts.push(`${(done / scale).toFixed(decimals)} / ${totalText}`);
  } else if (done !== null) {
    parts.push(formatBytes(done));
  }
  const speed = formatSpeed(p.speed_bps);
  if (speed) parts.push(speed);
  const eta = formatEtaRemaining(p.eta_seconds);
  if (eta) parts.push(eta);
  return parts;
}
