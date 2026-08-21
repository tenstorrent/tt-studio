// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // config-conventional's default types plus `release`, used for
    // rc-vX.Y.Z -> main pull requests (e.g. "release: v2.10.0").
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
        "release",
      ],
    ],
  },
};
