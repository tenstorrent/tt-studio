// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import React from "react";
import NavBar from "../components/NavBar";
import Footer from "../components/Footer";
import { isDeployedEnabled } from "../utils/env";

export const MainLayout = ({ children }: { children: React.ReactNode }) => (
  <>
    <NavBar />
    <div className="main-content pt-16 pb-20">{children}</div>
    {!isDeployedEnabled() && <Footer />}
  </>
);

export default MainLayout;
