// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { DeployedHome } from "../components/aiPlaygroundHome/DeployedHome";
import { RetroGrid } from "../components/ui/retro-grid";
import { useTheme } from "../providers/ThemeProvider";
import { useHeroSection } from "../providers/HeroSectionContext";
// import NavBar from "../components/NavBar";

const DeployedHomePage = () => {
  const { theme } = useTheme();
  const { showHero } = useHeroSection();
  return (
    <div className="relative min-h-screen w-full bg-white/95 dark:bg-black/95">
      {/* RetroGrid Background */}
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 scale-[2]">
          <RetroGrid
            className="w-full h-full transform-gpu"
            opacity={0.7}
            lightLineColor={
              theme === "dark"
                ? "rgba(124, 104, 250, 0.9)"
                : "rgba(124, 104, 250, 0.4)"
            }
            darkLineColor="rgba(124, 104, 250, 0.9)"
            cellSize={50}
            angle={55}
          />
        </div>
      </div>

      {/* Subtle gradient overlay */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            theme === "dark"
              ? "radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.8) 100%), linear-gradient(180deg, rgba(147, 51, 234, 0.1) 0%, rgba(124, 104, 250, 0.1) 100%)"
              : "radial-gradient(circle at center, transparent 0%, rgba(255,255,255,0.8) 100%), linear-gradient(180deg, rgba(124, 104, 250, 0.05) 0%, rgba(124, 104, 250, 0.1) 100%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10">
        <DeployedHome onlyCards={!showHero} />
      </div>
    </div>
  );
};

export default DeployedHomePage;
