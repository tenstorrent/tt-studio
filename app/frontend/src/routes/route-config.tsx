// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/*
 * Route Configuration
 * ------------------
 * This file contains the configuration for all application routes.
 *
 * Usage:
 * 1. Import this file: import { getRoutes } from './route-config';
 * 2. Get routes: const routes = getRoutes();
 *
 * Adding Routes:
 * {
 *   path: "/example",
 *   element: <ExampleComponent />,
 *   condition: true // optional, route will only be included if condition is true
 * }
 *
 * Notes:
 * - All routes will automatically be wrapped with MainLayout
 * - Use the 'condition' property for feature flags or environment-specific routes
 */

/**
 * @VITE_ENABLE_DEPLOYED
 * Controls which home page is shown as the default route and whether
 * the deployed home page is available as a separate route.
 * Values: "true" | "false"
 * Default: If not set or any value other than "true", deployed mode is disabled.
 * Effects:
 * - When "true": DeployedHomePage is used for the root route which is the ai playground home (/)
 * - When "false": HomePage is used for the root route and is the tt-studio home (/) and
 *                 DeployedHomePage is available at /deployed-home
 */

// Read environment variable for Vite
const isDeployedEnabled = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

import HomePage from "../pages/HomePage";
import ModelsDeployed from "../pages/ModelsDeployed";
import ChatUI from "../pages/ChatUIPage";
import RagManagement from "../components/rag/RagManagement";
import LogsPage from "../pages/LogsPage";
import ObjectDetectionPage from "../pages/ObjectDetectionPage";
import DeployedHomePage from "../pages/DeployedHomePage";
import NotFoundPage from "../pages/404Page";

// Define route configuration type
export interface RouteConfig {
  path: string;
  element: React.ReactNode;
  condition?: boolean;
}

// Function to generate routes based on environment variables
export const getRoutes = (): RouteConfig[] => {
  return [
    {
      path: "/",
      element: isDeployedEnabled ? <DeployedHomePage /> : <HomePage />,
      condition: true,
    },
    {
      path: "/models-deployed",
      element: <ModelsDeployed />,
      condition: true,
    },
    {
      path: "/chat-ui",
      element: <ChatUI />,
      condition: true,
    },
    {
      path: "/rag-management",
      element: <RagManagement />,
      condition: true,
    },
    {
      path: "/logs",
      element: <LogsPage />,
      condition: true,
    },
    {
      path: "/object-detection",
      element: <ObjectDetectionPage />,
      condition: true,
    },
    {
      path: "/deployed-home",
      element: <DeployedHomePage />,
      condition: !isDeployedEnabled,
    },
    {
      // catch all for all other routes
      path: "*",
      element: <NotFoundPage />,
      condition: true, // always include this route
    },
  ];
};
