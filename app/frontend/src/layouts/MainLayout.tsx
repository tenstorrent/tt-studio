// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import React from "react";
import NavBar from "../components/NavBar";
import Footer from "../components/Footer";
import { isDeployedEnabled } from "../utils/env";

export const MainLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative">
    <div
      className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
      style={{
        maskImage: "radial-gradient(ellipse at center, transparent 45%, black 100%)",
      }}
    ></div>
    <NavBar />
    <div className="main-content pt-16 pb-20 relative z-10">{children}</div>
    {!isDeployedEnabled() && <Footer />}
  </div>
);

export default MainLayout;
