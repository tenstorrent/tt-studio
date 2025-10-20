# Git Diff Functionality Overview

This document provides a clear description of how git diff operations are used throughout the TT-Studio project for automated license header management.

## Overview

The TT-Studio project uses `git diff` commands to identify changed files and automatically manage SPDX license headers. This ensures all modified code files maintain proper copyright and licensing information without manual intervention.

## Core Diff Operations

### 1. Changed Files Detection

The project uses several `git diff` commands to detect modified files in different environments:

#### In GitHub Actions (CI/CD)
- **Pull Requests**: `git diff --name-only --diff-filter=AM ${baseSha}...${headSha}`
  - **What it does**: Compares the base branch with the PR branch to find all Added (A) and Modified (M) files
  - **Purpose**: Identifies only the files changed in a PR for header validation
  - **Fallback**: If the three-dot comparison fails, falls back to two-dot comparison or HEAD~1

- **Push Events**: `git diff --name-only --diff-filter=AM HEAD~1`  
  - **What it does**: Compares current commit with the previous commit
  - **Purpose**: Finds files modified in the latest push

#### In Local Development
- **Staged Changes**: `git diff --cached --name-only --diff-filter=AM`
  - **What it does**: Lists files that have been staged for commit (in git index)
  - **Purpose**: Identifies files ready to be committed

- **Unstaged Changes**: `git diff --name-only --diff-filter=AM`
  - **What it does**: Lists files modified in the working directory but not yet staged
  - **Purpose**: Catches files being actively developed

- **Untracked Files**: `git ls-files --others --exclude-standard`
  - **What it does**: Lists new files not yet tracked by git (respects .gitignore)
  - **Purpose**: Includes completely new files that need headers

### 2. Diff Filter Parameters

The `--diff-filter=AM` flag is crucial:
- **A**: Added files (new files)
- **M**: Modified files (existing files that changed)
- **Excludes**: Deleted (D), Renamed (R), Copied (C), etc.

This ensures we only process files that actually exist and need header validation.

### 3. File Filtering After Diff

After getting the diff results, the system filters for:
- **File Extensions**: `.ts`, `.tsx`, `.js`, `.jsx` (TypeScript and JavaScript files)
- **Path Requirements**: Must be in `app/frontend/src/` directory
- **Exclusions**: Excludes `/ui/` subdirectory files

## Scripts Using Diff Operations

### check-headers-changed.js
**Purpose**: Validates that changed files have proper SPDX headers with current year

**Diff Usage**:
- Detects environment (GitHub Actions vs local)
- Uses appropriate diff command based on context
- Validates each changed file has required header format
- Fails CI if headers are missing or have wrong year

### add-headers.js
**Purpose**: Automatically adds SPDX headers to files missing them

**Diff Usage**:
- Can run on all files (`npm run header:fix`) or changed files only (`npm run header:fix:changed`)
- Uses same diff detection logic as header checker
- Only modifies files that don't already have proper headers

## Error Handling and Fallbacks

The diff operations include robust error handling:

1. **Multiple Comparison Strategies**: If `${baseSha}...${headSha}` fails, tries `${baseSha} ${headSha}`, then falls back to `HEAD~1`
2. **Environment Detection**: Automatically adjusts diff strategy based on GitHub Actions vs local environment
3. **Empty Results Handling**: Gracefully handles when no files are changed
4. **Git Command Failures**: Catches and handles git command execution errors

## Benefits of This Approach

1. **Automated Compliance**: Ensures all code changes maintain proper licensing headers
2. **CI Integration**: Prevents PRs from merging without proper headers
3. **Developer Friendly**: Provides fix commands for local development
4. **Selective Processing**: Only processes files that actually changed, improving performance
5. **Environment Aware**: Works consistently across different development and CI environments

## Example Scenarios

### Scenario 1: Local Development
Developer modifies `src/components/Chat.tsx`:
1. `git diff --name-only --diff-filter=AM` detects the change
2. Header checker validates the file has proper SPDX header
3. If missing, `npm run header:fix:changed` adds it automatically

### Scenario 2: Pull Request
PR modifies multiple files:
1. `git diff --name-only --diff-filter=AM origin/main...origin/feature-branch` lists all changed files
2. CI runs header check on each file
3. PR fails if any file lacks proper headers
4. Developer runs `npm run header:fix:changed` to fix issues

### Scenario 3: New File Addition
Developer creates new file `src/utils/helper.ts`:
1. `git ls-files --others --exclude-standard` detects the untracked file
2. Header scripts include it in processing
3. SPDX header is automatically added when running fix command

This diff-based approach ensures comprehensive and efficient license header management across the entire development lifecycle.