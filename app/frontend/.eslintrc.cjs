module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "plugin:prettier/recommended", // Prettier as a plugin
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs", "vite-env.d.ts","src/components/ui"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh", "header", "prettier"], 
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    "header/header": [
      "error",
      "line",
      [
        " SPDX-License-Identifier: Apache-2.0",
        " SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC",
      ],
    ],
    "prettier/prettier": "error", // Ensures Prettier rules are followed
    
  },
};
