import { defineConfig, ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const VITE_BACKEND_URL = "http://tt-studio-backend-api:8000";
// define mapping of backend apis proxy strings -> routes
const VITE_BACKEND_PROXY_MAPPING: { [key: string]: string } = {
  "docker-api": "docker",
  "models-api": "models",
  "app-api": "app",
};

const proxyConfig: Record<string, string | ProxyOptions> = Object.fromEntries(
  Object.entries(VITE_BACKEND_PROXY_MAPPING).map(([proxyPath, actualPath]) => [
    `/${proxyPath}`,
    {
      target: VITE_BACKEND_URL,
      changeOrigin: true,
      secure: true,
      // debug logging
      configure: (proxy: any, _options: any) => {
        proxy.on("error", (err: any, _req: any, _res: any) => {
          console.log("proxy error", err);
        });
        proxy.on("proxyReq", (proxyReq: any, req: any, _res: any) => {
          console.log("Sending Request to the Target:", req.method, req.url);
        });
        proxy.on("proxyRes", (proxyRes: any, req: any, _res: any) => {
          console.log(
            "Received Response from the Target:",
            proxyRes.statusCode,
            req.url
          );
        });
      },
      rewrite: (path: string) =>
        path.replace(new RegExp(`^/${proxyPath}`), `/${actualPath}`),
    },
  ])
);

// Add specific proxy configuration for the /reset-board endpoint
proxyConfig["/reset-board"] = {
  target: VITE_BACKEND_URL,
  changeOrigin: true,
  secure: true,
  configure: (proxy: any, _options: any) => {
    proxy.on("error", (err: any, _req: any, _res: any) => {
      console.log("proxy error", err);
    });
    proxy.on("proxyReq", (proxyReq: any, req: any, _res: any) => {
      console.log("Sending Request to the Target:", req.method, req.url);
    });
    proxy.on("proxyRes", (proxyRes: any, req: any, _res: any) => {
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
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    fs: {
      cachedChecks: false,
    },
    hmr: { clientPort: 3000 }, // Adjust HMR client port to match the server port
    proxy: proxyConfig,
  },
});
