// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { createContext } from "react";

export type HeroSectionContextType = {
  showHero: boolean;
  setShowHero: (val: boolean) => void;
};

export const HeroSectionContext = createContext<
  HeroSectionContextType | undefined
>(undefined);
