// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { createContext } from "react";

export type DeviceState =
  | "HEALTHY"
  | "BAD_STATE"
  | "RESETTING"
  | "NOT_PRESENT"
  | "UNKNOWN";

export interface DeviceInfo {
  index: number;
  board_type: string;
  bus_id: string;
  temperature: number;
  power: number;
  voltage: number;
}

export interface DeviceStateData {
  state: DeviceState;
  board_type: string;
  board_name: string;
  devices: DeviceInfo[];
  last_updated: string;
  reset_suggested: boolean;
}

export interface DeviceStateContextType {
  deviceState: DeviceStateData | null;
  loading: boolean;
  error: string | null;
  /** Immediately re-fetch device state and reschedule polling. */
  refresh: () => void;
}

export const DeviceStateContext = createContext<
  DeviceStateContextType | undefined
>(undefined);
