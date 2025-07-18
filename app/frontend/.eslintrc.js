module.exports = {
  root: true,
  extends: ["eslint:recommended", "plugin:react/recommended", "plugin:prettier/recommended"],
  plugins: ["headers"],
  rules: {
    "headers/header": [
      "error",
      [
        "/*",
        " * SPDX-License-Identifier: Apache-2.0",
        " * SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC",
        " */",
        "",
      ],
    ],
  },
};
