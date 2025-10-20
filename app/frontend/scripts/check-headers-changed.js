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
    // Check if we're in a GitHub Actions environment
    const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

    let allFiles = [];

    if (isGitHubActions) {
      // In GitHub Actions, use the same logic as the workflow
      const eventName = process.env.GITHUB_EVENT_NAME;

      if (eventName === "pull_request") {
        // For PRs, use the base and head SHAs from environment
        const baseSha = process.env.GITHUB_BASE_SHA;
        const headSha = process.env.GITHUB_SHA;

        let changedFiles = "";
        try {
          // Try multiple approaches to get changed files
          changedFiles = execSync(
            `git diff --name-only --diff-filter=AM ${baseSha}...${headSha}`,
            {
              encoding: "utf-8",
            }
          );
        } catch (error) {
          try {
            changedFiles = execSync(
              `git diff --name-only --diff-filter=AM ${baseSha} ${headSha}`,
              {
                encoding: "utf-8",
              }
            );
          } catch (error2) {
            changedFiles = execSync(
              "git diff --name-only --diff-filter=AM HEAD~1",
              {
                encoding: "utf-8",
              }
            );
          }
        }
        allFiles = changedFiles.split("\n").filter((f) => f.trim());
      } else {
        // For pushes, compare with previous commit
        const changedFiles = execSync(
          "git diff --name-only --diff-filter=AM HEAD~1",
          {
            encoding: "utf-8",
          }
        );
        allFiles = changedFiles.split("\n").filter((f) => f.trim());
      }
    } else {
      // Local development: get staged + unstaged + untracked changes
      const staged = execSync(
        "git diff --cached --name-only --diff-filter=AM",
        {
          encoding: "utf-8",
        }
      );
      const unstaged = execSync("git diff --name-only --diff-filter=AM", {
        encoding: "utf-8",
      });
      const untracked = execSync("git ls-files --others --exclude-standard", {
        encoding: "utf-8",
      });

      allFiles = [
        ...new Set([
          ...staged.split("\n"),
          ...unstaged.split("\n"),
          ...untracked.split("\n"),
        ]),
      ].filter((f) => f.trim());
    }

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
  console.error(
    "╭─────────────────────────────────────────────────────────────╮"
  );
  console.error(
    "│                    ✗ SPDX Header Errors                    │"
  );
  console.error(
    "╰─────────────────────────────────────────────────────────────╯"
  );
  console.error("");

  errors.forEach((err) => console.error(`  • ${err}`));

  console.error("");
  console.error(
    "──────────────────────────────────────────────────────────────"
  );
  console.error(
    `✗ Changed files must have SPDX headers with current year (${CURRENT_YEAR})`
  );
  console.error("");
  console.error("💡 To fix automatically:");
  console.error("   npm run header:fix:changed");
  console.error(
    "──────────────────────────────────────────────────────────────"
  );
  console.error("");
  process.exit(1);
}

console.log("✓ All changed files have proper SPDX headers with current year");
process.exit(0);
