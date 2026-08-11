// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import { DeviceStateProvider } from "../providers/DeviceStateContext";
import { BackendHealthProvider } from "../providers/BackendHealthProvider";
import { getRoutes } from "./route-config";
import { MainLayout } from "../layouts/MainLayout";
import { getSettings } from "../api/settingsApi";
import { cancelDeployment } from "../api/modelsDeployedApis";
import { DeploymentTray } from "../components/DeploymentTray";
import { useActiveDeploymentsContext } from "../providers/ActiveDeploymentsContext";

function FirstRunGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
    retry: 0,
  });

  useEffect(() => {
    if (!data) return;
    if (!data.setup_complete && location.pathname !== "/welcome") {
      navigate("/welcome", { replace: true });
    }
  }, [data, location.pathname, navigate]);

  return <>{children}</>;
}

const AppRouter = () => {
  const routes = getRoutes();
  const { deployments, progressByJob, removeDeployment } =
    useActiveDeploymentsContext();

  return (
    <BackendHealthProvider>
      <DeviceStateProvider>
        <RefreshProvider>
          <ModelsProvider>
            <Router>
              <FirstRunGuard>
                <Routes>
                  {routes
                    .filter((route) => route.condition !== false)
                    .map((route) => (
                      <Route
                        key={route.path}
                        path={route.path}
                        element={
                          route.bare ? (
                            route.element
                          ) : (
                            <MainLayout>{route.element}</MainLayout>
                          )
                        }
                      />
                    ))}
                </Routes>
              </FirstRunGuard>
              {/* Rendered inside the Router (not the provider) so an item click can navigate. */}
              <DeploymentTray
                deployments={deployments}
                progressByJob={progressByJob}
                onDismiss={removeDeployment}
                onCancel={(jobId) => {
                  void cancelDeployment(jobId);
                  removeDeployment(jobId);
                }}
              />
            </Router>
          </ModelsProvider>
        </RefreshProvider>
      </DeviceStateProvider>
    </BackendHealthProvider>
  );
};

export default AppRouter;
