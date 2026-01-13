// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { FooterVisibilityContext } from "../contexts/FooterVisibilityContext";

export const FooterVisibilityProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [showFooter, setShowFooter] = useState(() => {
    const storedFooterVal = localStorage.getItem("showFooter");
    return storedFooterVal !== null
      ? storedFooterVal === "true"
      : window.location.pathname === "/";
  });

  useEffect(() => {
    localStorage.setItem("showFooter", showFooter ? "true" : "false");
  }, [showFooter]);

  return (
    <FooterVisibilityContext.Provider value={{ showFooter, setShowFooter }}>
      {children}
    </FooterVisibilityContext.Provider>
  );
};
