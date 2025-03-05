// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import NavBar from "../components/NavBar";
import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import ProtectedRoute from "./components/protected-route";
import { getRoutes, type RouteConfig } from "./route-config";

// Define a layout component
const MainLayout = ({ children }: { children: React.ReactNode }) => (
  <>
    <NavBar />
    {children}
  </>
);

const AppRouter = () => {
  // Get routes from configuration
  const routes = getRoutes();

  // Log environment variables for debugging
  console.log("isLoginEnabled", import.meta.env.VITE_ENABLE_LOGIN === "true");
  console.log(
    "isDeployedEnabled",
    import.meta.env.VITE_ENABLE_DEPLOYED === "true"
  );

  // Helper function to render route elements
  const renderRouteElement = (route: RouteConfig) => {
    if (!route.protected) {
      return route.element;
    }

    const Component = route.component;
    return (
      <ProtectedRoute>
        <MainLayout>
          <Component />
        </MainLayout>
      </ProtectedRoute>
    );
  };

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
                  element={renderRouteElement(route)}
                />
              ))}
          </Routes>
        </Router>
      </ModelsProvider>
    </RefreshProvider>
  );
};

export default AppRouter;
