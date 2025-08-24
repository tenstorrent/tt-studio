// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { createContext } from "react";

export interface RefreshContextType {
  refreshTrigger: number;
  triggerRefresh: () => void;
  triggerHardwareRefresh: () => Promise<void>; // New function for hardware cache refresh
}

export const RefreshContext = createContext<RefreshContextType | undefined>(undefined);
