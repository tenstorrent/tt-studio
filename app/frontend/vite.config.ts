// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { defineConfig, type HttpProxy, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { ClientRequest, IncomingMessage, ServerResponse } from "http";

const VITE_BACKEND_URL = "http://tt-studio-backend-api:8000";
// define mapping of backend apis proxy strings -> routes
const VITE_BACKEND_PROXY_MAPPING: { [key: string]: string } = {
  "docker-api": "docker",
  "models-api": "models",
  "app-api": "app",
  "collections-api": "collections",
  "logs-api": "logs",
};

const proxyConfig: Record<string, string | ProxyOptions> = Object.fromEntries(
  Object.entries(VITE_BACKEND_PROXY_MAPPING).map(([proxyPath, actualPath]) => [
    `/${proxyPath}`,
    {
      target: VITE_BACKEND_URL,
      changeOrigin: true,
      secure: true,
      // debug logging removed
      configure: (proxy: HttpProxy.Server) => {
        proxy.on("error", (_err: Error, _req: IncomingMessage, _res: ServerResponse) => {
          // Error handling removed
        });
        proxy.on(
          "proxyReq",
          (_proxyReq: ClientRequest, _req: IncomingMessage, _res: ServerResponse) => {
            // Request logging removed
          },
        );
        proxy.on(
          "proxyRes",
          (_proxyRes: IncomingMessage, _req: IncomingMessage, _res: ServerResponse) => {
            // Response logging removed
          },
        );
      },
      rewrite: (path: string) => path.replace(new RegExp(`^/${proxyPath}`), `/${actualPath}`),
    },
  ]),
);

// Add specific proxy configuration for the /reset-board endpoint
proxyConfig["/reset-board"] = {
  target: VITE_BACKEND_URL,
  changeOrigin: true,
  secure: true,
  configure: (proxy) => {
    proxy.on("error", (_err: Error) => {
      // Error handling removed
    });
    proxy.on("proxyReq", (_proxyReq: ClientRequest, _req: IncomingMessage) => {
      // Request logging removed
    });
    proxy.on("proxyRes", (_proxyRes: IncomingMessage, _req: IncomingMessage) => {
      // Response logging removed
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    fs: {
      // Remove the cachedChecks property as it's not supported in the current Vite version
      // If you need to disable file system caching, use the strict property instead
      strict: false,
    },
    hmr: { clientPort: 3000 }, // Adjust HMR client port to match the server port
    proxy: proxyConfig,
    allowedHosts: ["localhost", "playground.tenstorrent.com"],
  },
});
