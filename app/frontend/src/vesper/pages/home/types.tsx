// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { TtSmiDevice } from "@/src/api/telemetryApi";

export interface HardwarePageData {
  boards: BoardData[];
}

export interface BoardData {
  id: string;
  name: string;
  devices: TtSmiDevice[];
}
