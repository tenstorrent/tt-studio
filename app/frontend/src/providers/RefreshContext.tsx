// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { createContext, useContext, useState } from "react";

interface RefreshContextType {
  refreshTrigger: number;
  triggerRefresh: () => void;
  triggerHardwareRefresh: () => Promise<void>; // New function for hardware cache refresh
}

const RefreshContext = createContext<RefreshContextType | undefined>(undefined);

export const RefreshProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const triggerHardwareRefresh = async () => {
    try {
      console.log("Triggering hardware cache refresh...");
      const response = await fetch("/board-api/refresh-cache/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        console.log("Hardware cache refreshed successfully");
        // Also trigger regular refresh to update UI
        triggerRefresh();
      } else {
        console.warn("Failed to refresh hardware cache:", response.status);
      }
    } catch (error) {
      console.error("Error triggering hardware refresh:", error);
    }
  };

  return (
    <RefreshContext.Provider value={{ refreshTrigger, triggerRefresh, triggerHardwareRefresh }}>
      {children}
    </RefreshContext.Provider>
  );
};

export const useRefresh = () => {
  const context = useContext(RefreshContext);
  if (context === undefined) {
    throw new Error("useRefresh must be used within a RefreshProvider");
  }
  return context;
};
