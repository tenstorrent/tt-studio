// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import NavBar from "../components/NavBar";
import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import { getRoutes } from "./route-config";

// Define a layout component
const MainLayout = ({ children }: { children: React.ReactNode }) => (
  <>
    <NavBar />
    <div className="main-content ">{children}</div>
  </>
);
import ImageGenPage from "../pages/ImageGenPage";
import NotFoundPage from "../pages/NotFoundPage";
import AudioDetectionPage from "../pages/AudioDetectionPage.tsx";

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
            <Route path="/image-generation" element={<ImageGenPage />} />
            <Route path="/audio-detection" element={<AudioDetectionPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Router>
      </ModelsProvider>
    </RefreshProvider>
  );
};

export default AppRouter;
