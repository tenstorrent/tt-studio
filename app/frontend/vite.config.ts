// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { defineConfig, HttpProxy, ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { ClientRequest, IncomingMessage, ServerResponse } from "http";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const VITE_BACKEND_URL = "http://tt-studio-backend-api:8000";
// define mapping of backend apis proxy strings -> routes
const VITE_BACKEND_PROXY_MAPPING: { [key: string]: string } = {
  "docker-api": "docker",
  "models-api": "models",
  "app-api": "app",
  "collections-api": "collections",
  "logs-api": "logs",
  "board-api": "board",
  "training-api": "training",
};

const proxyConfig: Record<string, string | ProxyOptions> = Object.fromEntries(
  Object.entries(VITE_BACKEND_PROXY_MAPPING).map(([proxyPath, actualPath]) => [
    `/${proxyPath}`,
    {
      target: VITE_BACKEND_URL,
      changeOrigin: true,
      secure: true,
      // Ensure proper timeout handling for long-running requests
      timeout: 0,
      // debug logging
      configure: (proxy: HttpProxy.Server) => {
        proxy.on(
          "error",
          (err: Error, _req: IncomingMessage, _res: ServerResponse) => {
            console.log("proxy error", err);
          }
        );
        proxy.on(
          "proxyReq",
          (
            proxyReq: ClientRequest,
            req: IncomingMessage,
            _res: ServerResponse
          ) => {
            console.log("Sending Request to the Target:", req.method, req.url);

            // Ensure proper headers for SSE requests
            if (req.headers.accept?.includes("text/event-stream")) {
              proxyReq.setHeader("Cache-Control", "no-cache");
              proxyReq.setHeader("Connection", "keep-alive");
            }
          }
        );
        proxy.on(
          "proxyRes",
          (
            proxyRes: IncomingMessage,
            req: IncomingMessage,
            res: ServerResponse
          ) => {
            console.log(
              "Received Response from the Target:",
              proxyRes.statusCode,
              req.url
            );

            // Handle SSE responses properly
            if (
              proxyRes.headers["content-type"]?.includes("text/event-stream")
            ) {
              res.setHeader("Cache-Control", "no-cache");
              res.setHeader("Connection", "keep-alive");
              res.setHeader("Access-Control-Allow-Origin", "*");
              res.setHeader(
                "Access-Control-Allow-Headers",
                "Content-Type, Accept"
              );
            }
          }
        );
      },
      rewrite: (path: string) =>
        path.replace(new RegExp(`^/${proxyPath}`), `/${actualPath}`),
    },
  ])
);

proxyConfig["/ws-api"] = {
  target: VITE_BACKEND_URL,
  ws: true,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/ws-api/, "/ws"),
};

// Add specific proxy configuration for the /reset-board endpoint
proxyConfig["/reset-board"] = {
  target: VITE_BACKEND_URL,
  changeOrigin: true,
  secure: true,
  configure: (proxy) => {
    proxy.on("error", (err) => {
      console.log("proxy error", err);
    });
    proxy.on("proxyReq", (proxyReq, req) => {
      console.log("Sending Request to the Target:", req.method, req.url);
    });
    proxy.on("proxyRes", (proxyRes, req) => {
      console.log(
        "Received Response from the Target:",
        proxyRes.statusCode,
        req.url
      );
    });
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Serve Silero VAD assets (ONNX model, audio worklet, ort wasms) from
    // the dev/build root so MicVAD's default fetch paths resolve. stripBase:true
    // flattens the src node_modules/.../dist/ tree to flat filenames at "/".
    viteStaticCopy({
      targets: [
        { src: "node_modules/@ricky0123/vad-web/dist/*.onnx", dest: "", rename: { stripBase: true } },
        { src: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js", dest: "", rename: { stripBase: true } },
        { src: "node_modules/onnxruntime-web/dist/*.wasm", dest: "", rename: { stripBase: true } },
        // ort-web dynamically imports companion .mjs shims for each wasm
        { src: "node_modules/onnxruntime-web/dist/ort-wasm-*.mjs", dest: "", rename: { stripBase: true } },
      ],
    }),
  ],
  define: {
    // Inject package.json version as environment variable
    "import.meta.env.VITE_PACKAGE_VERSION": JSON.stringify(
      process.env.npm_package_version || "2.0.1"
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    hmr: { clientPort: 3000 },
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: proxyConfig,
    allowedHosts: ["localhost", "playground.tenstorrent.com"],
  },
});
