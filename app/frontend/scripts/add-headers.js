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

function getChangedFiles() {
  try {
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
