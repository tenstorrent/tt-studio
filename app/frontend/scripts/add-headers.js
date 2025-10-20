#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/**
 * SPDX Header Management Script
 * 
 * This script automatically adds SPDX license headers to TypeScript and JavaScript files
 * in the frontend source directory. It uses git diff operations to intelligently detect
 * which files need header processing.
 * 
 * Key Features:
 * - Environment-aware: Works in both CI (GitHub Actions) and local development
 * - Selective processing: Can target all files or only changed files (--changed-only)
 * - Smart detection: Uses various git diff strategies to find modified files
 * - Non-destructive: Only adds headers to files that don't already have them
 * - Current year: Automatically uses the current year in copyright headers
 * 
 * Usage:
 *   npm run header:fix           # Add headers to all eligible files
 *   npm run header:fix:changed   # Add headers only to changed files
 * 
 * The script processes files that:
 * - Have extensions: .ts, .tsx, .js, .jsx
 * - Are located in: app/frontend/src/
 * - Are not in: /ui/ subdirectory (component library)
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import { execSync } from "child_process";

const CURRENT_YEAR = new Date().getFullYear();
const HEADER = `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © ${CURRENT_YEAR} Tenstorrent AI ULC

`;

const HEADER_REGEX =
  /^\/\/ SPDX-License-Identifier: Apache-2\.0\n\/\/ SPDX-FileCopyrightText: © \d{4} Tenstorrent AI ULC/;

/**
 * Detects changed files using git diff operations for header addition
 * 
 * This function mirrors the logic in check-headers-changed.js to ensure
 * consistent file detection across header management scripts.
 * 
 * Uses intelligent diff strategies:
 * - GitHub Actions: Branch/commit comparisons for CI environments  
 * - Local Development: Staged + unstaged + untracked file detection
 * 
 * @returns {string[]} Array of changed file paths that need header processing
 */
function getChangedFiles() {
  try {
    // Check if we're in a GitHub Actions environment
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    
    let allFiles = [];
    
    if (isGitHubActions) {
      // In GitHub Actions, use the same logic as the workflow
      const eventName = process.env.GITHUB_EVENT_NAME;
      
      if (eventName === 'pull_request') {
        // For PRs, compare with base branch using refs
        // This compares the PR branch against the target branch (usually main)
        // to find all files modified in this specific pull request
        const baseRef = process.env.GITHUB_BASE_REF || 'main';
        const headRef = process.env.GITHUB_HEAD_REF || 'main';
        const changedFiles = execSync(`git diff --name-only --diff-filter=AM origin/${baseRef}...origin/${headRef}`, {
          encoding: "utf-8",
        });
        allFiles = changedFiles.split('\n').filter(f => f.trim());
      } else {
        // For pushes, compare with previous commit
        // This finds files changed in the latest commit to the branch
        const changedFiles = execSync("git diff --name-only --diff-filter=AM HEAD~1", {
          encoding: "utf-8",
        });
        allFiles = changedFiles.split('\n').filter(f => f.trim());
      }
    } else {
      // Local development: Comprehensive change detection
      // Captures all possible modifications in the developer's working environment
      
      // Staged changes: Files that have been `git add`ed and are ready for commit
      const staged = execSync("git diff --cached --name-only --diff-filter=AM", {
        encoding: "utf-8",
      });
      
      // Unstaged changes: Files modified in working directory but not yet staged
      const unstaged = execSync("git diff --name-only --diff-filter=AM", {
        encoding: "utf-8",
      });
      
      // Untracked files: Completely new files not yet added to git version control
      const untracked = execSync("git ls-files --others --exclude-standard", {
        encoding: "utf-8",
      });

      // Merge all change types and remove duplicates using Set
      allFiles = [
        ...new Set([
          ...staged.split("\n"),
          ...unstaged.split("\n"),
          ...untracked.split("\n"),
        ]),
      ].filter(f => f.trim());
    }

    return allFiles
      .filter(
        (file) =>
          file.match(/\.(ts|tsx|js|jsx)$/) &&
          file.startsWith("app/frontend/src/") &&
          !file.includes("/ui/")
      )
      .map((file) => file.replace("app/frontend/", ""));
  } catch (error) {
    return [];
  }
}

function getAllSourceFiles() {
  const cwd = path.resolve(process.cwd());
  return glob.sync("src/**/*.{ts,tsx,js,jsx}", {
    cwd: cwd,
    ignore: ["**/node_modules/**", "**/dist/**", "**/ui/**"],
    absolute: true,
  });
}

function hasHeader(content) {
  return HEADER_REGEX.test(content);
}

function addHeaderToFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");

  // Skip if already has header
  if (hasHeader(content)) {
    return false;
  }

  // Add header
  fs.writeFileSync(filePath, HEADER + content, "utf-8");
  return true;
}

// Main execution
const changedOnly = process.argv.includes("--changed-only");
const files = changedOnly ? getChangedFiles() : getAllSourceFiles();

console.log(`Checking ${files.length} file(s) for missing SPDX headers...\n`);
console.log(`Adding headers with year: ${CURRENT_YEAR}\n`);

let modifiedCount = 0;

files.forEach((file) => {
  if (addHeaderToFile(file)) {
    console.log(`✓ Added header to: ${file}`);
    modifiedCount++;
  }
});

if (modifiedCount === 0) {
  console.log("✓ All files already have SPDX headers");
} else {
  console.log(`\n✓ Added headers to ${modifiedCount} file(s)`);
}

process.exit(0);
