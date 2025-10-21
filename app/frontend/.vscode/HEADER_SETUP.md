# SPDX Header Auto-Addition Setup

This document explains how the automatic SPDX header system works in TT Studio frontend.

## Overview

TT Studio requires all source files to include SPDX license headers:

```javascript
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
```

We provide **two complementary approaches** to ensure headers are added:

1. **Automatic on Save** - VS Code automatically adds headers when you save files
2. **Manual Scripts** - npm scripts to add headers on demand or in CI/CD

## Method 1: Automatic on Save (Recommended for Development)

### Prerequisites

1. Install the ESLint extension in VS Code:
   - Extension ID: `dbaeumer.vscode-eslint`
   - Or run: `code --install-extension dbaeumer.vscode-eslint`

2. Ensure VS Code settings are configured (already done in `.vscode/settings.json`):
   ```json
   {
     "editor.codeActionsOnSave": {
       "source.fixAll.eslint": "always"
     }
   }
   ```

### How It Works

1. **ESLint Rule**: The `eslint-plugin-headers` plugin checks for SPDX headers
2. **Auto-Fix**: Set to `"error"` level in `eslint.config.js` to enable auto-fix
3. **On Save**: VS Code runs ESLint auto-fix when you save any `.ts`, `.tsx`, `.js`, or `.jsx` file
4. **Result**: Headers are automatically added if missing

### Testing Auto-Save

1. Create a new file: `src/test-auto-header.tsx`
2. Add some code without a header:
   ```typescript
   export const TestComponent = () => {
     return <div>Test</div>;
   };
   ```
3. Save the file (Cmd+S / Ctrl+S)
4. The header should be automatically added at the top

### Troubleshooting Auto-Save

If headers are not being added automatically:

1. **Check ESLint Extension**: Ensure it's installed and enabled
   - Open Command Palette: `ESLint: Show Output Channel`
   - Look for errors or warnings

2. **Restart ESLint Server**: 
   - Command Palette → `ESLint: Restart ESLint Server`

3. **Check Settings**:
   - Verify `.vscode/settings.json` has `"source.fixAll.eslint": "always"`
   - Check that `eslint.config.js` has the header rule set to `"error"`

4. **Check File Location**:
   - Auto-fix only works for files in `src/` directory
   - Files in `node_modules/`, `dist/`, or `src/components/ui/` are excluded

## Method 2: Manual Scripts (For CI/CD and Batch Operations)

### Available Scripts

Run these from the `app/frontend` directory:

#### Check Headers
```bash
# Check all files for headers (ESLint)
npm run header:check

# Check only changed files (git-aware)
npm run header:check:changed

# Strict check (fails on any warnings)
npm run header:check:strict
```

#### Fix Headers
```bash
# Add headers to all source files
npm run header:fix
# or
npm run header:fix:all

# Add headers only to changed files (git-aware)
npm run header:fix:changed

# Preview what would be changed (dry run)
npm run header:fix:dry-run

# Verbose output showing all operations
npm run header:fix:verbose
```

### Script Features

- **Error Handling**: Gracefully handles file read/write errors
- **Dry Run Mode**: Preview changes without modifying files
- **Verbose Mode**: See detailed information about each file
- **Git-Aware**: Can target only changed files for efficiency
- **Year Management**: Automatically uses current year in headers

### Examples

```bash
# Before committing, fix headers on changed files only
npm run header:fix:changed

# Check what would be changed without modifying files
npm run header:fix:dry-run

# Fix all files with detailed output
npm run header:fix:verbose

# Verify all headers are correct
npm run header:check:strict
```

## CI/CD Integration

The header check scripts are designed to work in GitHub Actions and other CI environments:

```yaml
# Example GitHub Actions workflow
- name: Check SPDX Headers
  run: |
    cd app/frontend
    npm run header:check:changed
```

The scripts automatically detect GitHub Actions environment and adjust git commands accordingly.

## File Exclusions

Headers are **not** added to:

- Config files: `*.config.js`, `*.config.ts`
- Test files: `*.test.ts`, `*.spec.js`, etc.
- Type definition files: `*.d.ts`
- UI component library: `src/components/ui/*`
- Generated files: `node_modules/`, `dist/`, `build/`
- Non-code files: `*.json`, `*.md`, `*.txt`, `*.yml`

## Year Handling

- **Current Year**: Headers use the current year (e.g., 2025)
- **Validation**: Accepts any year 2024 or later
- **Updates**: When fixing headers, always uses current year
- **Consistency**: Both auto-save and manual scripts use the same year

## Best Practices

1. **Use Auto-Save During Development**: Let VS Code handle headers automatically
2. **Run Manual Scripts Before Committing**: Ensure all files have headers
3. **Use Dry Run for Preview**: Check what will change before applying
4. **Check Changed Files in CI**: Validate headers in pull requests
5. **Keep Extensions Updated**: Ensure ESLint extension is current

## Support

If you encounter issues:

1. Check this documentation
2. Review `.vscode/settings.json` configuration
3. Inspect `eslint.config.js` header rule
4. Check ESLint extension output in VS Code
5. Run manual scripts with `--verbose` flag for debugging

## Technical Details

### ESLint Configuration

Location: `eslint.config.js`

```javascript
"header/header-format": [
  "error", // Enables auto-fix
  {
    source: "string",
    style: "line",
    content: `SPDX-License-Identifier: Apache-2.0\nSPDX-FileCopyrightText: © {year} Tenstorrent AI ULC`,
    variables: {
      year: currentYear.toString(),
    },
  },
],
```

### VS Code Settings

Location: `.vscode/settings.json`

```json
{
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "always"
  }
}
```

### Script Implementation

Location: `scripts/add-headers.js`

- Uses Node.js file system APIs
- Integrates with git for changed file detection
- Supports GitHub Actions environment
- Provides multiple output modes (normal, verbose, dry-run)



