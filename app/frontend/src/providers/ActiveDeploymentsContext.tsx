// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { createContext, useContext, useState, type ReactNode } from "react";
import { useActiveDeployments } from "../hooks/useActiveDeployments";

type ActiveDeploymentsValue = ReturnType<typeof useActiveDeployments> & {
  /** True while a page that renders its own per-model progress owns the display. */
  trayHidden: boolean;
  setTrayHidden: (hidden: boolean) => void;
};

const ActiveDeploymentsContext = createContext<ActiveDeploymentsValue | null>(null);

// Session-wide deployment tracker, mounted once at the app root so in-flight
// deploys stay tracked on every page. The floating tray that surfaces this state
// is rendered inside the Router (see AppRouter) so clicking an item can navigate.
export function ActiveDeploymentsProvider({ children }: { children: ReactNode }) {
  const value = useActiveDeployments();
  const [trayHidden, setTrayHidden] = useState(false);
  return (
    <ActiveDeploymentsContext.Provider value={{ ...value, trayHidden, setTrayHidden }}>
      {children}
    </ActiveDeploymentsContext.Provider>
  );
}

export function useActiveDeploymentsContext(): ActiveDeploymentsValue {
  const ctx = useContext(ActiveDeploymentsContext);
  if (!ctx) {
    throw new Error("useActiveDeploymentsContext must be used within ActiveDeploymentsProvider");
  }
  return ctx;
}
