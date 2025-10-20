#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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

// Parse command line arguments
const args = process.argv.slice(2);
const changedOnly = args.includes("--changed-only");
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose") || args.includes("-v");

function getChangedFiles() {
  try {
    // Check if we're in a GitHub Actions environment
    const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

    let allFiles = [];

    if (isGitHubActions) {
      // In GitHub Actions, use the same logic as the workflow
      const eventName = process.env.GITHUB_EVENT_NAME;

      if (eventName === "pull_request") {
        // For PRs, compare with base branch using refs
        const baseRef = process.env.GITHUB_BASE_REF || "main";
        const headRef = process.env.GITHUB_HEAD_REF || "main";
        const changedFiles = execSync(
          `git diff --name-only --diff-filter=AM origin/${baseRef}...origin/${headRef}`,
          {
            encoding: "utf-8",
          }
        );
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
  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // Skip if already has header
    if (hasHeader(content)) {
      if (verbose) {
        console.log(`  ⊘ Skipped (already has header): ${filePath}`);
      }
      return false;
    }

    // Dry run - just report what would be done
    if (dryRun) {
      console.log(`  [DRY RUN] Would add header to: ${filePath}`);
      return true;
    }

    // Add header
    fs.writeFileSync(filePath, HEADER + content, "utf-8");
    return true;
  } catch (error) {
    console.error(`  ✗ Error processing ${filePath}: ${error.message}`);
    return false;
  }
}

// Main execution
const files = changedOnly ? getChangedFiles() : getAllSourceFiles();

if (dryRun) {
  console.log("🔍 DRY RUN MODE - No files will be modified\n");
}

console.log(`Checking ${files.length} file(s) for missing SPDX headers...`);
console.log(`Header year: ${CURRENT_YEAR}`);
if (verbose) {
  console.log(`Mode: ${changedOnly ? "Changed files only" : "All files"}`);
}
console.log();

let modifiedCount = 0;
let errorCount = 0;

files.forEach((file) => {
  const result = addHeaderToFile(file);
  if (result === true) {
    if (!dryRun) {
      console.log(`✓ Added header to: ${file}`);
    }
    modifiedCount++;
  } else if (result === false && verbose) {
    // Already logged in verbose mode
  }
});

console.log();
if (dryRun) {
  if (modifiedCount === 0) {
    console.log("✓ All files already have SPDX headers (dry run)");
  } else {
    console.log(`📋 Would add headers to ${modifiedCount} file(s) (dry run)`);
  }
} else {
  if (modifiedCount === 0) {
    console.log("✓ All files already have SPDX headers");
  } else {
    console.log(`✓ Added headers to ${modifiedCount} file(s)`);
  }
}

if (verbose) {
  console.log(`\nSummary: ${files.length} checked, ${modifiedCount} modified`);
}

process.exit(0);
