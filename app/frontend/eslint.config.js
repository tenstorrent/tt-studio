// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import a11yPlugin from "eslint-plugin-jsx-a11y";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

const eslintConfig = [
  {
    // Global settings to recognize built-in types
    languageOptions: {
      globals: {
        ...tsPlugin.configs.recommended.globals,
        // Additional global types you might need
        HTMLDivElement: "readonly",
        React: "readonly",
      },
    },
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/out/**",
      "**/build/**",
      "**/dist/**",
      // ! temp ignore for the components/ui directory which are sourced from shadcnn or other such libraries
      "**/components/ui/**",
      // Tmp ignore files that we know will be fixed or removed in future
      "**/components/SideBar.tsx",
    ],
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": a11yPlugin,
      prettier: prettierPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        window: true,
        document: true,
        navigator: true,
        console: true,
        setTimeout: true,
        clearTimeout: true,
        setInterval: true,
        clearInterval: true,
        fetch: true,
        Blob: true,
        FormData: true,
        localStorage: true,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...a11yPlugin.configs.recommended.rules,
      "prettier/prettier": [
        "error",
        {
          semi: true,
          trailingComma: "all",
          singleQuote: false,
          printWidth: 100,
          tabWidth: 2,
        },
      ],
      "react/react-in-jsx-scope": "off", // React 17+ JSX transform
      "react/prop-types": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "jsx-a11y/anchor-is-valid": "off",
      "no-undef": "off", // Disabled as TypeScript handles type checking
      "no-console": "warn",
    },
  },
  prettierConfig,
];

import reactRefreshPlugin from "eslint-plugin-react-refresh";
import prettierPlugin from "eslint-plugin-prettier";
import headersPlugin from "eslint-plugin-headers";

export default eslintConfig;
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
        ecmaVersion: 2021,
        sourceType: "module",
        project: "./tsconfig.json",
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
      "no-console": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
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
  // Additional Custom Rules
  {
    rules: {
      // Add any other custom rules here
    },
  };
