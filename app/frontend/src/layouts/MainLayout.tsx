// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import React from "react";
import { useLocation } from "react-router-dom";
import NavBar from "../components/NavBar";
import Footer from "../components/Footer";
import CyberneticGridShader from "../components/ui/cybernetic-grid-shader";

export const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  // Restrict the WebGL shader to the landing page so other routes stay
  // performant and visually quiet.
  const showShader = pathname === "/";

  return (
    <div className="min-h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative">
      {/* Animated background lives BELOW the radial vignette overlay so the
          existing edge-fade keeps working and softens the shader's corners. */}
      {showShader && (
        <CyberneticGridShader className="absolute inset-0 overflow-hidden" />
      )}
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 45%, black 100%)",
        }}
      ></div>
      <NavBar />
      <div
        className="main-content pt-16 relative z-10"
        style={{ paddingBottom: "var(--footer-height, 0px)" }}
      >
        {children}
      </div>
      <Footer />
    </div>
  );
};

export default MainLayout;
