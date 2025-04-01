// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { defineConfig, HttpProxy, ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { ClientRequest, IncomingMessage, ServerResponse } from "http";

const VITE_BACKEND_URL = "http://tt-studio-backend-api:8000";
// For external APIs that might need CORS handling
const VITE_IMAGE_API_URL = process.env.VITE_IMAGE_API_URL;

// define mapping of backend apis proxy strings -> routes
const VITE_BACKEND_PROXY_MAPPING = {
  "docker-api": "docker",
  "models-api": "models",
  "app-api": "app",
  "collections-api": "collections",
  "logs-api": "logs",
  "image-api": "image", // Added image API proxy if needed
};

// CORS headers to include with all proxied requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Max-Age": "86400",
};

// Create proxy configurations for each endpoint
const proxyConfig = Object.fromEntries(
  Object.entries(VITE_BACKEND_PROXY_MAPPING).map(([proxyPath, actualPath]) => [
    `/${proxyPath}`,
    {
      target: VITE_BACKEND_URL,
      changeOrigin: true,
      secure: false, // Set to false if using self-signed certificates
      ws: true, // Support WebSockets if needed
      
      // Add CORS headers to responses
      configure: (proxy) => {
        proxy.on("error", (err, req, res) => {
          console.log("Proxy error:", err);
        });
        
        proxy.on("proxyReq", (proxyReq, req, res) => {
          console.log("Sending Request to the Target:", req.method, req.url);
        });
        
        proxy.on("proxyRes", (proxyRes, req, res) => {
          console.log(
            "Received Response from the Target:",
            proxyRes.statusCode,
            req.url
          );
          
          // Add CORS headers to the response
          Object.entries(corsHeaders).forEach(([header, value]) => {
            proxyRes.headers[header] = value;
          });
        });
      },
      
      // Handle OPTIONS requests for CORS preflight
      async handle(req, res, next) {
        if (req.method === 'OPTIONS') {
          res.writeHead(200, corsHeaders);
          return res.end();
        }
        next();
      },
      
      // Rewrite the path for the backend
      rewrite: (path) =>
        path.replace(new RegExp(`^/${proxyPath}`), `/${actualPath}`),
    },
  ])
);

// Add specific proxy configuration for the /reset-board endpoint
proxyConfig["/reset-board"] = {
  target: VITE_BACKEND_URL,
  changeOrigin: true,
  secure: false,
  headers: corsHeaders,
  
  configure: (proxy) => {
    proxy.on("error", (err) => {
      console.log("Proxy error:", err);
    });
    
    proxy.on("proxyReq", (proxyReq, req) => {
      console.log("Sending Request to the Target:", req.method, req.url);
    });
    
    proxy.on("proxyRes", (proxyRes, req, res) => {
      console.log(
        "Received Response from the Target:",
        proxyRes.statusCode,
        req.url
      );
      
      // Add CORS headers to the response
      Object.entries(corsHeaders).forEach(([header, value]) => {
        proxyRes.headers[header] = value;
      });
    });
  },
  
  // Handle OPTIONS requests for CORS preflight
  async handle(req, res, next) {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, corsHeaders);
      return res.end();
    }
    next();
  }
};

// Add a special proxy for external image API if needed
if (VITE_IMAGE_API_URL) {
  proxyConfig["/external-image-api"] = {
    target: VITE_IMAGE_API_URL,
    changeOrigin: true,
    secure: false,
    headers: corsHeaders,
    rewrite: (path) => path.replace(/^\/external-image-api/, ""),
    configure: (proxy) => {
      proxy.on("proxyRes", (proxyRes, req, res) => {
        Object.entries(corsHeaders).forEach(([header, value]) => {
          proxyRes.headers[header] = value;
        });
      });
    },
    async handle(req, res, next) {
      if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders);
        return res.end();
      }
      next();
    }
  };
}

// Add a dedicated proxy for the YOLOv4 Inference server
proxyConfig["/objdetection"] = {
  target: "https://tt-metal-yolov4-inference-server-1b385ea4.workload.tenstorrent.com",
  changeOrigin: true,
  secure: true,
  headers: corsHeaders,
  rewrite: (path) => path.replace(/^\/objdetection/, "/objdetection_v2"),
  configure: (proxy) => {
    proxy.on("error", (err) => {
      console.log("YOLOv4 proxy error:", err);
    });
    proxy.on("proxyReq", (proxyReq, req, res) => {
      // Log complete request info for debugging
      console.log("YOLOv4 proxy request:", {
        method: req.method,
        url: req.url,
        headers: req.headers
      });
      
      // Make sure Content-Type is properly set
      if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        console.log("Preserving multipart/form-data Content-Type");
      }
    });
    proxy.on("proxyRes", (proxyRes, req, res) => {
      console.log("YOLOv4 response:", proxyRes.statusCode);
      
      // Log the complete response for debugging
      let responseBody = '';
      proxyRes.on('data', (chunk) => {
        responseBody += chunk;
      });
      proxyRes.on('end', () => {
        console.log("YOLOv4 response body:", responseBody);
      });
      
      Object.entries(corsHeaders).forEach(([header, value]) => {
        proxyRes.headers[header] = value;
      });
    });
  },
  async handle(req, res, next) {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, corsHeaders);
      return res.end();
    }
    next();
  }
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
      cachedChecks: false,
    },
    hmr: { clientPort: 3000 }, // Adjust HMR client port to match the server port
    proxy: proxyConfig,
    allowedHosts: ["localhost", "playground.tenstorrent.com"],
    
    // Additional CORS settings at server level
    cors: {
      origin: "*",
      methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
    }
  },
});