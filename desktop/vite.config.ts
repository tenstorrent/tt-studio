// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// Vite serves the bundled launcher UI only. The real TT-Studio frontend is
// never bundled here — the Tauri window navigates to it at
// http://localhost:3000 (see src-tauri/src/commands.rs).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Don't clear the terminal — `tauri dev` shares it with cargo output.
  clearScreen: false,
  server: {
    // tauri.conf.json's devUrl expects this exact port.
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
  },
  test: {
    environment: "jsdom",
  },
});
