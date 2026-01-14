// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { FooterVisibilityContext } from "../contexts/FooterVisibilityContext";
import { safeGetItem, safeSetItem } from "../lib/storage";

export const FooterVisibilityProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [showFooter, setShowFooter] = useState(() => {
    const storedFooterVal = safeGetItem<boolean | null>("showFooter", null);
    return storedFooterVal !== null
      ? storedFooterVal
      : window.location.pathname === "/";
  });

  useEffect(() => {
    safeSetItem("showFooter", showFooter);
  }, [showFooter]);

  return (
    <FooterVisibilityContext.Provider value={{ showFooter, setShowFooter }}>
      {children}
    </FooterVisibilityContext.Provider>
  );
};
