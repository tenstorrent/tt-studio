// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { HeroSectionContext } from "./HeroSectionContext";

export const HeroSectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [showHero, setShowHero] = useState(() => {
    const val = localStorage.getItem("showHeroSection");
    return val === "true";
  });

  useEffect(() => {
    localStorage.setItem("showHeroSection", showHero ? "true" : "false");
  }, [showHero]);

  return (
    <HeroSectionContext.Provider value={{ showHero, setShowHero }}>
      {children}
    </HeroSectionContext.Provider>
  );
};
