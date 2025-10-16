#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const CURRENT_YEAR = new Date().getFullYear().toString();
const MIN_YEAR = "2024"; // Project start year

const REQUIRED_HEADER_REGEX =
  /^\/\/ SPDX-License-Identifier: Apache-2\.0\n\/\/ SPDX-FileCopyrightText: © \d{4} Tenstorrent AI ULC/;

function getChangedFiles() {
  try {
    // Get staged + unstaged changes
    const staged = execSync("git diff --cached --name-only --diff-filter=AM", {
      encoding: "utf-8",
    });
    const unstaged = execSync("git diff --name-only --diff-filter=AM", {
      encoding: "utf-8",
    });
    const untracked = execSync("git ls-files --others --exclude-standard", {
      encoding: "utf-8",
    });

    const allFiles = [
      ...new Set([
        ...staged.split("\n"),
        ...unstaged.split("\n"),
        ...untracked.split("\n"),
      ]),
    ];

    // Filter for JS/TS files in frontend
    return allFiles
      .filter(
        (file) =>
          file.match(/\.(ts|tsx|js|jsx)$/) &&
          file.startsWith("app/frontend/src/") &&
          !file.includes("/ui/")
      )
      .map((file) => file.replace("app/frontend/", ""));
  } catch (error) {
    console.error("Error getting changed files:", error.message);
    return [];
  }
}

function checkFileHeader(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Check if header exists
  if (lines.length < 2) return { valid: false, year: null };

  const headerText = lines.slice(0, 3).join("\n");

  // Check format
  if (!REQUIRED_HEADER_REGEX.test(headerText)) {
    return { valid: false, year: null };
  }

  // Extract year
  const yearMatch = headerText.match(/© (\d{4})/);
  const year = yearMatch ? yearMatch[1] : null;

  // Validate year is current year
  if (year !== CURRENT_YEAR) {
    return { valid: false, year, expectedYear: CURRENT_YEAR };
  }

  return { valid: true, year };
}

// Main execution
const changedFiles = getChangedFiles();

if (changedFiles.length === 0) {
  console.log("✓ No changed frontend files to check");
  process.exit(0);
}

console.log(
  `Checking ${changedFiles.length} changed file(s) for SPDX headers with year ${CURRENT_YEAR}...\n`
);

let hasErrors = false;
const errors = [];

changedFiles.forEach((file) => {
  const result = checkFileHeader(file);

  if (!result.valid) {
    hasErrors = true;
    if (result.year && result.expectedYear) {
      errors.push(
        `${file}: Has year ${result.year}, expected ${result.expectedYear}`
      );
    } else if (result.year === null) {
      errors.push(`${file}: Missing or invalid SPDX header`);
    }
  }
});

if (hasErrors) {
  console.error("✗ SPDX Header Errors:\n");
  errors.forEach((err) => console.error(`  ${err}`));
  console.error(
    `\n✗ Changed files must have SPDX headers with current year (${CURRENT_YEAR})`
  );
  console.error(`\nTo fix: npm run header:fix:changed\n`);
  process.exit(1);
}

console.log("✓ All changed files have proper SPDX headers with current year");
process.exit(0);
