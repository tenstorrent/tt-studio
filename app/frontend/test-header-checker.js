#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DIR = "src/test-files";
const CURRENT_YEAR = new Date().getFullYear();

// Test scenarios
const testCases = [
  {
    name: "Missing header",
    content: `import React from 'react';

export const TestComponent = () => {
  return <div>Test</div>;
};`,
    shouldFail: true,
    expectedError: "Missing or invalid SPDX header",
  },
  {
    name: "Wrong year (2024)",
    content: `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';

export const TestComponent = () => {
  return <div>Test</div>;
};`,
    shouldFail: true,
    expectedError: `Has year 2024, expected ${CURRENT_YEAR}`,
  },
  {
    name: "Correct year (current)",
    content: `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © ${CURRENT_YEAR} Tenstorrent AI ULC

import React from 'react';

export const TestComponent = () => {
  return <div>Test</div>;
};`,
    shouldFail: false,
  },
  {
    name: "Malformed header",
    content: `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI

import React from 'react';

export const TestComponent = () => {
  return <div>Test</div>;
};`,
    shouldFail: true,
    expectedError: "Missing or invalid SPDX header",
  },
  {
    name: "Missing license identifier",
    content: `// SPDX-FileCopyrightText: © ${CURRENT_YEAR} Tenstorrent AI ULC

import React from 'react';

export const TestComponent = () => {
  return <div>Test</div>;
};`,
    shouldFail: true,
    expectedError: "Missing or invalid SPDX header",
  },
];

function createTestFiles() {
  // Create test directory
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }

  // Create test files
  testCases.forEach((testCase, index) => {
    const filename = `test-${index + 1}-${testCase.name.toLowerCase().replace(/\s+/g, "-")}.tsx`;
    const filepath = path.join(TEST_DIR, filename);
    fs.writeFileSync(filepath, testCase.content);
    console.log(`✓ Created test file: ${filename}`);
  });
}

function runHeaderCheck() {
  try {
    console.log("\n🔍 Running header check on test files...\n");
    const output = execSync("npm run header:check:changed", {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    console.log("Output:", output);
    return { success: true, output };
  } catch (error) {
    console.log("Output:", error.stdout || error.message);
    return { success: false, output: error.stdout || error.message };
  }
}

function runHeaderFix() {
  try {
    console.log("\n🔧 Running header fix on test files...\n");
    const output = execSync("npm run header:fix:changed", {
      encoding: "utf-8",
      cwd: process.cwd(),
    });
    console.log("Output:", output);
    return { success: true, output };
  } catch (error) {
    console.log("Output:", error.stdout || error.message);
    return { success: false, output: error.stdout || error.message };
  }
}

function verifyResults() {
  console.log("\n📋 Verifying results...\n");

  testCases.forEach((testCase, index) => {
    const filename = `test-${index + 1}-${testCase.name.toLowerCase().replace(/\s+/g, "-")}.tsx`;
    const filepath = path.join(TEST_DIR, filename);

    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, "utf-8");
      const hasCorrectHeader =
        content.includes(`// SPDX-License-Identifier: Apache-2.0`) &&
        content.includes(
          `// SPDX-FileCopyrightText: © ${CURRENT_YEAR} Tenstorrent AI ULC`
        );

      console.log(
        `${hasCorrectHeader ? "✅" : "❌"} ${testCase.name}: ${hasCorrectHeader ? "PASS" : "FAIL"}`
      );

      if (!hasCorrectHeader && testCase.shouldFail) {
        console.log(`   Expected to fail: ${testCase.expectedError}`);
      }
    }
  });
}

function cleanup() {
  console.log("\n🧹 Cleaning up test files...\n");
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    console.log("✓ Test files cleaned up");
  }
}

function main() {
  console.log("🧪 Frontend Header Checker Test Suite");
  console.log("=====================================\n");

  try {
    // Create test files
    console.log("📁 Creating test files...\n");
    createTestFiles();

    // Stage test files for git
    console.log("\n📝 Staging test files for git...\n");
    execSync(`git add ${TEST_DIR}/*`, { stdio: "pipe" });

    // Run header check (should fail for some files)
    const checkResult = runHeaderCheck();

    // Run header fix
    const fixResult = runHeaderFix();

    // Verify results
    verifyResults();

    // Summary
    console.log("\n📊 Test Summary");
    console.log("================\n");
    console.log(
      `Header Check: ${checkResult.success ? "PASSED" : "FAILED (as expected)"}`
    );
    console.log(`Header Fix: ${fixResult.success ? "PASSED" : "FAILED"}`);
    console.log("\n✅ Test completed successfully!");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  } finally {
    // Cleanup
    cleanup();

    // Unstage files
    try {
      execSync(`git reset HEAD ${TEST_DIR}/*`, { stdio: "pipe" });
    } catch (e) {
      // Ignore if files weren't staged
    }
  }
}

// Run the test
main();
