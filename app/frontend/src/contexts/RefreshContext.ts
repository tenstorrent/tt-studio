// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { createContext } from "react";

export interface RefreshContextType {
  refreshTrigger: number;
  triggerRefresh: () => void;
  triggerHardwareRefresh: () => Promise<void>; // New function for hardware cache refresh
  resetAllNonce: number; // Bumped after a full board reset (Reset All), not single resets.
  triggerResetAll: () => void;
}

export const RefreshContext = createContext<RefreshContextType | undefined>(
  undefined
);
