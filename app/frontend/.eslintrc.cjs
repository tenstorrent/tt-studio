module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs", "vite-env.d.ts"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh", "header"],
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
  },
};
