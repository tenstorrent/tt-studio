// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { HfCheckResult, HfCheckStatus } from "../api/settingsApi";

/** Check outcomes that mean a gated model cannot be deployed. "error" is absent on
 *  purpose: it means the check couldn't reach Hugging Face, which is our problem,
 *  not a gate. */
export const HF_BLOCKING_STATUSES: readonly HfCheckStatus[] = [
  "no_token",
  "auth_failed",
  "denied",
];

export function isHfBlocked(result?: HfCheckResult): boolean {
  return !!result && HF_BLOCKING_STATUSES.includes(result.status);
}

export function statusLabel(r: HfCheckResult): string {
  switch (r.status) {
    case "granted":
      return "Access confirmed";
    case "denied":
      return "Access not granted yet";
    case "auth_failed":
      return "Token invalid or expired";
    case "no_token":
      return "No token saved";
    default:
      return `Could not reach Hugging Face${r.http_status ? ` (HTTP ${r.http_status})` : ""}`;
  }
}
