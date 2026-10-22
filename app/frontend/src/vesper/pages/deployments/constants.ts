// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { DeploymentState } from "@/src/vesper/types";

export const STATE_LABEL: Record<DeploymentState, string> = {
  downloading: "Downloading",
  deploying: "Deploying",
  active: "Active",
  "download-failed": "Download failed",
  "deploy-failed": "Deployment failed",
  error: "Error",
};
