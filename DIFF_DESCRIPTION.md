# Clear Description of Git Diff Operations

## What the Diff Does

The TT-Studio project uses **git diff** commands to automatically manage SPDX license headers on code files. Here's a clear breakdown of what each diff operation accomplishes:

### Primary Purpose
The diff operations identify which files have been **Added** or **Modified** so that:
1. **License headers can be automatically added** to new/changed files
2. **Header compliance can be validated** before code is merged
3. **Only changed files are processed**, improving performance and reducing noise

### Specific Diff Commands and Their Purpose

#### 1. `git diff --name-only --diff-filter=AM ${baseSha}...${headSha}`
- **What it does**: Finds all Added (A) and Modified (M) files between two git commits/branches
- **When used**: In GitHub Actions for Pull Request validation
- **Why important**: Only processes files that actually changed in the PR, not the entire codebase

#### 2. `git diff --cached --name-only --diff-filter=AM` 
- **What it does**: Lists files that have been staged for commit (via `git add`)
- **When used**: Local development environment
- **Why important**: Catches files the developer is actively preparing to commit

#### 3. `git diff --name-only --diff-filter=AM`
- **What it does**: Lists files modified in the working directory but not yet staged
- **When used**: Local development environment  
- **Why important**: Includes files being actively edited

#### 4. `git ls-files --others --exclude-standard`
- **What it does**: Lists completely new files not yet tracked by git
- **When used**: Local development environment
- **Why important**: Ensures new files get proper license headers from the start

### The `--diff-filter=AM` Flag Explained
- **A = Added files**: Brand new files that need license headers
- **M = Modified files**: Existing files that changed and need header validation
- **Excludes**: Deleted (D), Renamed (R), Copied (C) files that don't need processing

### Real-World Example
When a developer creates a new React component `src/components/NewFeature.tsx`:

1. **Local Development**: `git ls-files --others --exclude-standard` detects the new untracked file
2. **After `git add`**: `git diff --cached --name-only --diff-filter=AM` shows it's staged
3. **In PR Review**: `git diff --name-only --diff-filter=AM main...feature-branch` identifies it as changed
4. **Automated Action**: The SPDX header scripts automatically add proper licensing to the file

### Bottom Line
These diff operations enable **automated license compliance** by intelligently detecting which files need attention, ensuring every piece of code maintains proper copyright headers without manual developer intervention.