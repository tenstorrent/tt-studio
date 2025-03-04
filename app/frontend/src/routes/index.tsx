// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "../pages/HomePage";
import ModelsDeployed from "../pages/ModelsDeployed";
import NavBar from "../components/NavBar";
import ChatUI from "../pages/ChatUIPage";
import { RefreshProvider } from "../providers/RefreshContext";
import { ModelsProvider } from "../providers/ModelsContext";
import RagManagement from "../components/rag/RagManagement";
import LogsPage from "../pages/LogsPage";
import ObjectDetectionPage from "../pages/ObjectDetectionPage";
import LoginPage from "../pages/LoginPage.tsx";
import ProtectedRoute from "./components/protected-route.tsx";
import DeployedHomePage from "../pages/DeployedHomePage";

const AppRouter = () => {
  // Read environment variables for Vite
  const isLoginEnabled = import.meta.env.VITE_ENABLE_LOGIN === "true";
  const isDeployedEnabled = import.meta.env.VITE_ENABLE_DEPLOYED === "true";
  console.log("isLoginEnabled", isLoginEnabled);
  console.log("isDeployedEnabled", isDeployedEnabled);

  return (
    <RefreshProvider>
      <ModelsProvider>
        <Router>
          <Routes>
            {/* Conditionally render login route based on environment variable */}
            {isLoginEnabled && <Route path="/login" element={<LoginPage />} />}

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <>
                    <NavBar />
                    {isDeployedEnabled ? <DeployedHomePage /> : <HomePage />}
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/models-deployed"
              element={
                <ProtectedRoute>
                  <>
                    <NavBar />
                    <ModelsDeployed />
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/chat-ui"
              element={
                <ProtectedRoute>
                  <>
                    <NavBar />
                    <ChatUI />
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/rag-management"
              element={
                <ProtectedRoute>
                  <>
                    <NavBar />
                    <RagManagement />
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/logs"
              element={
                <ProtectedRoute>
                  <>
                    <NavBar />
                    <LogsPage />
                  </>
                </ProtectedRoute>
              }
            />
            <Route
              path="/object-detection"
              element={
                <ProtectedRoute>
                  <>
                    <NavBar />
                    <ObjectDetectionPage />
                  </>
                </ProtectedRoute>
              }
            />

            {/* Conditionally render deployed home page based on environment variable */}
            {!isDeployedEnabled && (
              <Route
                path="/deployed-home"
                element={
                  <ProtectedRoute>
                    <>
                      <NavBar />
                      <DeployedHomePage />
                    </>
                  </ProtectedRoute>
                }
              />
            )}
          </Routes>
        </Router>
      </ModelsProvider>
    </RefreshProvider>
  );
};

export default AppRouter;
