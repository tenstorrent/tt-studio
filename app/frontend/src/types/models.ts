// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { HealthBadgeRef } from "../components/HealthBadge";

export type HealthStatus = "healthy" | "unavailable" | "unhealthy" | "unknown";

export interface ModelRow {
  id: string;
  name?: string;
  image?: string;
  status?: string;
  ports?: string;
}

export interface ColumnVisibilityMap {
  containerId: boolean;
  image: boolean;
  ports: boolean;
}

export type HealthRefsMap = Map<string, HealthBadgeRef>;
