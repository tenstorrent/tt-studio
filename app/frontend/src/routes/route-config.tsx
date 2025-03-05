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
 * - For public routes (no authentication required):
 *   {
 *     path: "/example",
 *     element: <ExampleComponent />,
 *     protected: false,
 *     condition: true // optional, route will only be included if condition is true
 *   }
 *
 * - For protected routes (requires authentication):
 *   {
 *     path: "/protected-example",
 *     component: ExampleComponent, // Pass the component class/function, not TSX
 *     protected: true,
 *     condition: true // optional
 *   }
 *
 * Notes:
 * - Protected routes will automatically be wrapped with ProtectedRoute and MainLayout
 * - Use the 'condition' property for feature flags or environment-specific routes
 * - For protected routes, use 'component' (not 'element') and pass the component itself
 */

/**
 * Environment Variables
 * --------------------
 * @VITE_ENABLE_LOGIN
 * Controls whether the login page is available in the application.
 * Values: "true" | "false"
 * Default: If not set or any value other than "true", login is disabled.
 * Effect: When "true", the /login route is added to the application.
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

// Read environment variables for Vite
const isLoginEnabled = import.meta.env.VITE_ENABLE_LOGIN === "true";
const isDeployedEnabled = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

import HomePage from "../pages/HomePage";
import ModelsDeployed from "../pages/ModelsDeployed";
import ChatUI from "../pages/ChatUIPage";
import RagManagement from "../components/rag/RagManagement";
import LogsPage from "../pages/LogsPage";
import ObjectDetectionPage from "../pages/ObjectDetectionPage";
import LoginPage from "../pages/LoginPage";
import DeployedHomePage from "../pages/DeployedHomePage";
import NotFoundPage from "../pages/404Page";

// Define route configuration types
export interface BaseRouteConfig {
  path: string;
  condition?: boolean;
}

export interface PublicRouteConfig extends BaseRouteConfig {
  element: React.ReactNode;
  protected?: false;
}

export interface ProtectedRouteConfig extends BaseRouteConfig {
  component: React.ComponentType<any>;
  protected: true;
}

export type RouteConfig = PublicRouteConfig | ProtectedRouteConfig;

// Function to generate routes based on environment variables
export const getRoutes = (): RouteConfig[] => {
  return [
    //! Public routes
    {
      path: "/login",
      element: <LoginPage />,
      protected: false,
      condition: isLoginEnabled,
    },
    {
      // catch all for all other routes
      path: "*",
      element: <NotFoundPage />,
      protected: false,
      condition: true, // always include this route,
    },
    //! Protected routes
    {
      path: "/",
      component: isDeployedEnabled ? DeployedHomePage : HomePage,
      protected: true,
    },
    {
      path: "/models-deployed",
      component: ModelsDeployed,
      protected: true,
    },
    {
      path: "/chat-ui",
      component: ChatUI,
      protected: true,
    },
    {
      path: "/rag-management",
      component: RagManagement,
      protected: true,
    },
    {
      path: "/logs",
      component: LogsPage,
      protected: true,
    },
    {
      path: "/object-detection",
      component: ObjectDetectionPage,
      protected: true,
    },
    {
      path: "/deployed-home",
      component: DeployedHomePage,
      protected: true,
      condition: !isDeployedEnabled,
    },
  ];
};
