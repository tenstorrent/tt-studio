import { createContext } from "react";

export type HeroSectionContextType = {
  showHero: boolean;
  setShowHero: (val: boolean) => void;
};

export const HeroSectionContext = createContext<HeroSectionContextType | undefined>(undefined);
