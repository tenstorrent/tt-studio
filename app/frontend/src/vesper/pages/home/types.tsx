// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface DeviceCardData {
  paired: boolean;
  name: string;
  boards: DeviceBoardData[];
};

export type DeviceBoardState = "idle" | "deploying" | "busy" | "error";

export interface DeviceBoardData {
  tag: string;
  state: DeviceBoardState;
  cpu: number;
  ram: number;
  temp: number;
};
