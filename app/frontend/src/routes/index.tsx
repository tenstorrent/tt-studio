// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import { getRoutes } from "./route-config";
import { MainLayout } from "../layouts/MainLayout";

const AppRouter = () => {
  // Get routes from configuration
  const routes = getRoutes();

  // Log environment variables for debugging
  console.log(
    "isDeployedEnabled",
    import.meta.env.VITE_ENABLE_DEPLOYED === "true"
  );

  return (
    <RefreshProvider>
      <ModelsProvider>
        <Router>
          <Routes>
            {routes
              .filter((route) => route.condition !== false)
              .map((route) => (
                <Route
                  key={route.path}
                  path={route.path}
                  element={<MainLayout>{route.element}</MainLayout>}
                />
              ))}
          </Routes>
        </Router>
      </ModelsProvider>
    </RefreshProvider>
  );
};

export default AppRouter;
