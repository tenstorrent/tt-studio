#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/**
 * SPDX Header Validation Script
 * 
 * This script validates that all changed files have proper SPDX license headers
 * with the current year. It uses git diff operations to identify which files
 * have been modified and need header validation.
 * 
 * Key Features:
 * - CI Integration: Designed to run in GitHub Actions workflows
 * - Smart diff detection: Uses multiple git diff strategies for robust file detection
 * - Environment-aware: Adapts behavior for CI vs local development environments
 * - Strict validation: Ensures headers have correct format and current year
 * - Helpful feedback: Provides clear error messages and fix instructions
 * 
 * Validation Rules:
 * - Header must start with: // SPDX-License-Identifier: Apache-2.0
 * - Second line must be: // SPDX-FileCopyrightText: © [CURRENT_YEAR] Tenstorrent AI ULC
 * - Copyright year must match the current year
 * 
 * Git Diff Operations Used:
 * - Pull Requests: Compares PR branch with base branch
 * - Push Events: Compares with previous commit  
 * - Local Dev: Includes staged, unstaged, and untracked changes
 * 
 * Exit Codes:
 * - 0: All files have valid headers
 * - 1: One or more files have invalid or missing headers
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const CURRENT_YEAR = new Date().getFullYear().toString();
const MIN_YEAR = "2024"; // Project start year

const REQUIRED_HEADER_REGEX =
  /^\/\/ SPDX-License-Identifier: Apache-2\.0\n\/\/ SPDX-FileCopyrightText: © \d{4} Tenstorrent AI ULC/;

/**
 * Detects changed files using git diff operations
 * 
 * This function intelligently determines which files have been modified based on the environment:
 * - In GitHub Actions (CI): Compares branches or commits to find PR/push changes
 * - In Local Development: Includes staged, unstaged, and untracked changes
 * 
 * The git diff commands used:
 * - `git diff --name-only --diff-filter=AM` = Lists Added/Modified files only
 * - `--diff-filter=AM` excludes deleted, renamed, or copied files
 * - Different comparison strategies ensure compatibility across environments
 * 
 * @returns {string[]} Array of changed file paths relative to repository root
 */
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
          // Primary approach: Three-dot diff compares merge base with PR head
          // This shows only changes introduced in the PR branch
          changedFiles = execSync(
            `git diff --name-only --diff-filter=AM ${baseSha}...${headSha}`,
            {
              encoding: "utf-8",
            }
          );
        } catch (error) {
          try {
            // Fallback 1: Two-dot diff compares commits directly
            // This may include more changes but ensures we get results
            changedFiles = execSync(
              `git diff --name-only --diff-filter=AM ${baseSha} ${headSha}`,
              {
                encoding: "utf-8",
              }
            );
          } catch (error2) {
            // Fallback 2: Compare with previous commit
            // Last resort when SHA comparisons fail
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
        // This captures all changes in the latest commit
        const changedFiles = execSync(
          "git diff --name-only --diff-filter=AM HEAD~1",
          {
            encoding: "utf-8",
          }
        );
        allFiles = changedFiles.split("\n").filter((f) => f.trim());
      }
    } else {
      // Local development: Comprehensive change detection
      // This captures all possible file modifications for developer workflow
      
      // Staged changes: Files ready to be committed (git add has been run)
      const staged = execSync(
        "git diff --cached --name-only --diff-filter=AM",
        {
          encoding: "utf-8",
        }
      );
      
      // Unstaged changes: Files modified but not yet staged (working directory changes)
      const unstaged = execSync("git diff --name-only --diff-filter=AM", {
        encoding: "utf-8",
      });
      
      // Untracked files: New files not yet added to git (respects .gitignore)
      const untracked = execSync("git ls-files --others --exclude-standard", {
        encoding: "utf-8",
      });

      // Combine all types of changes, removing duplicates
      allFiles = [
        ...new Set([
          ...staged.split("\n"),
          ...unstaged.split("\n"),
          ...untracked.split("\n"),
        ]),
      ].filter((f) => f.trim());
    }

    // Filter for JS/TS files in frontend source directory
    // This ensures we only process files that:
    // 1. Are TypeScript/JavaScript files (.ts, .tsx, .js, .jsx)
    // 2. Are in the frontend source directory (app/frontend/src/)
    // 3. Are not in the UI component library directory (/ui/)
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
