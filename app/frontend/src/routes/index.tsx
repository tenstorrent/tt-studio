// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import { DeviceStateProvider } from "../providers/DeviceStateContext";
import { BackendHealthProvider } from "../providers/BackendHealthProvider";
import { getRoutes } from "./route-config";
import { getSettings } from "../api/settingsApi";
import { Layout } from "@/src/vesper/layout";

function FirstRunGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    staleTime: 60_000,
    retry: 0,
  });

  // `python run.py run <model>` opens the app with ?auto-deploy=<model>. The CLI
  // has already dealt with credentials on its side, and bouncing to /welcome here
  // would drop the query string and swallow the deploy. Skip the first-run guide
  // for that page session — the auto-deploy handler rewrites the URL to
  // ?resume=<id> once the job is fired, so the decision has to be sticky.
  const cliLaunchRef = useRef(false);
  if (new URLSearchParams(location.search).has("auto-deploy")) {
    cliLaunchRef.current = true;
  }

  useEffect(() => {
    if (!data) return;
    if (cliLaunchRef.current) return;
    if (!data.setup_complete && location.pathname !== "/welcome") {
      navigate("/welcome", { replace: true });
    }
  }, [data, location.pathname, location.search, navigate]);

  return <>{children}</>;
}

const AppRouter = () => {
  const routes = getRoutes();

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
                          <Layout
                            title={route.title}
                            hideSidebar={route.hideSidebar}
                            hideHeader={route.hideHeader}
                            hideFooter={route.hideFooter}
                          >
                            {route.element}
                          </Layout>
                        }
                      />
                    ))}
                </Routes>
              </FirstRunGuard>
              {/* In-flight deploys are shown on the deployments page, and flagged
                  on its sidebar item everywhere else. */}
            </Router>
          </ModelsProvider>
        </RefreshProvider>
      </DeviceStateProvider>
    </BackendHealthProvider>
  );
};

export default AppRouter;
