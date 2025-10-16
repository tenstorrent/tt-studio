# SPDX Header Testing

This directory contains tools for testing and managing SPDX license headers in the frontend codebase.

## Files

- `test-header-checker.js` - Comprehensive test suite for header validation
- `scripts/check-headers-changed.js` - Script to check headers on git-changed files only
- `scripts/add-headers.js` - Script to add headers to files missing them

## Usage

### Run the Test Suite

```bash
npm run header:test
```

This will:
1. Create 5 test files with different header scenarios
2. Run the header checker (should fail for some files)
3. Run the header fixer (should fix most issues)
4. Verify the results
5. Clean up automatically

### Check Headers on Changed Files

```bash
npm run header:check:changed
```

Only checks files that have been modified in git (staged, unstaged, or untracked).

### Fix Headers on Changed Files

```bash
npm run header:fix:changed
```

Adds SPDX headers with current year to files that are missing them.

### Check All Files

```bash
npm run header:check
```

Runs ESLint on all files to check header compliance.

## Test Scenarios

The test suite covers:

1. **Missing header** - File with no SPDX header
2. **Wrong year (2024)** - File with 2024 header (should require 2025)
3. **Correct year (current)** - File with current year header
4. **Malformed header** - File with incomplete SPDX header
5. **Missing license identifier** - File missing the license line

## GitHub Actions Integration

The GitHub Actions workflow automatically:
- Checks changed files for proper headers with current year
- Runs ESLint only on changed frontend files
- Fails CI if changed files have wrong/missing headers
- Skips checks if no frontend files changed

## Future-Proof Design

- Automatically uses current year (2025, 2026, etc.)
- Accepts any year 2024+ for existing files
- Enforces current year only for changed files
- No code changes needed as years progress
