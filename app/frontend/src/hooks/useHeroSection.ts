import { useContext } from "react";
import { HeroSectionContext } from "../contexts/HeroSectionContext";

export const useHeroSection = () => {
  const ctx = useContext(HeroSectionContext);
  if (!ctx) throw new Error("useHeroSection must be used within a HeroSectionProvider");
  return ctx;
};
