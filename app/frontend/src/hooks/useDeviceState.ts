// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useContext } from "react";
import { DeviceStateContext } from "../contexts/DeviceStateContext";

export const useDeviceState = () => {
  const context = useContext(DeviceStateContext);
  if (context === undefined) {
    throw new Error("useDeviceState must be used within a DeviceStateProvider");
  }
  return context;
};
