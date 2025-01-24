// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactRefreshPlugin from "eslint-plugin-react-refresh";
import prettierPlugin from "eslint-plugin-prettier";
import headersPlugin from "eslint-plugin-headers";
import globals from "globals";

export default [
  // JavaScript Standard Configurations
  js.configs.recommended,

  // TypeScript Plugin Configuration
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
    },
  },

  // React Plugin Configuration
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-refresh": reactRefreshPlugin,
    },
    settings: {
      react: {
        version: "detect", // Automatically detect the React version
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off", // Disable if using React 17+
      "no-console": "off", // Allow console statements
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Prettier Plugin Configuration
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      "prettier/prettier": "error",
    },
  },

  // License Header Plugin Configuration
  {
    files: ["**/*.{js,jsx,ts,tsx}"], // Apply to all JS/TS files
    plugins: {
      headers: headersPlugin,
    },
    rules: {
      "headers/header-format": [
        "error",
        {
          source: "string",
          content: [
            "SPDX-License-Identifier: Apache-2.0",
            "SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC",
          ].join("\n"),
          style: "line", // Use single-line comments
        },
      ],
    },
  },

  // Environment Configuration
  {
    files: ["**/*.{js,jsx,ts,tsx}"], // Apply to all JS/TS files
    languageOptions: {
      globals: {
        ...globals.browser, // Include browser globals (e.g., console, setTimeout)
        ...globals.node, // Include Node.js globals (e.g., require, module)
      },
    },
  },

  // Additional Custom Rules
  {
    rules: {
      // Add any other custom rules here
    },
  },
];
