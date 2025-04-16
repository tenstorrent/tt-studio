// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { DeployedHome } from "../components/aiPlaygroundHome/DeployedHome";
import { RetroGrid } from "../components/ui/retro-grid";

const DeployedHomePage = () => {
  return (
    <div className="relative min-h-screen w-full bg-black/95">
      {/* RetroGrid Background */}
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 scale-[2]">
          <RetroGrid
            className="w-full h-full transform-gpu"
            opacity={0.7}
            lightLineColor="rgba(147, 51, 234, 0.3)"
            darkLineColor="rgba(124, 104, 250, 0.9)"
            cellSize={50}
            angle={55}
          />
        </div>
      </div>

      {/* Subtle gradient overlay */}
      <div
        className="fixed inset-0 pointer-events-none bg-gradient-to-b from-transparent via-black/20 to-black/80"
        style={{
          background:
            "radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.8) 100%), linear-gradient(180deg, rgba(147, 51, 234, 0.1) 0%, rgba(124, 104, 250, 0.1) 100%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10">
        <DeployedHome />
      </div>
    </div>
  );
};

export default DeployedHomePage;
