import React, { createContext, useContext, useState, useEffect } from "react";

type HeroSectionContextType = {
  showHero: boolean;
  setShowHero: (val: boolean) => void;
};

const HeroSectionContext = createContext<HeroSectionContextType | undefined>(
  undefined,
);

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

export const useHeroSection = () => {
  const ctx = useContext(HeroSectionContext);
  if (!ctx)
    throw new Error("useHeroSection must be used within a HeroSectionProvider");
  return ctx;
};
