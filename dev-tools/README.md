# Developer Tools

This directory contains development tools and utilities for the TT-Studio project.

## SPDX Header Tool

The `add_spdx_header.py` script automatically adds SPDX license headers to source code files throughout the project.

### Overview

This tool ensures all source files have proper SPDX license headers according to the Apache-2.0 license and Tenstorrent AI ULC copyright. It supports multiple file types and uses appropriate comment syntax for each.

### Supported File Types

| File Type             | Extensions                   | Comment Style      | Example                                        |
| --------------------- | ---------------------------- | ------------------ | ---------------------------------------------- |
| Python                | `.py`                        | `# comment`        | `# SPDX-License-Identifier: Apache-2.0`        |
| Shell Scripts         | `.sh`                        | `# comment`        | `# SPDX-License-Identifier: Apache-2.0`        |
| Dockerfiles           | `Dockerfile`                 | `# comment`        | `# SPDX-License-Identifier: Apache-2.0`        |
| TypeScript/JavaScript | `.ts`, `.tsx`, `.js`, `.jsx` | `// comment`       | `// SPDX-License-Identifier: Apache-2.0`       |
| CSS                   | `.css`                       | `/* comment */`    | `/* SPDX-License-Identifier: Apache-2.0 */`    |
| HTML                  | `.html`, `.htm`              | `<!-- comment -->` | `<!-- SPDX-License-Identifier: Apache-2.0 -->` |

### Directories Processed

The tool processes the following directories:

- `app/backend/` - Backend Python/Django code
- `app/frontend/` - Frontend React/TypeScript code

### Excluded Directories

The tool automatically skips the following directories:

- `node_modules/` - External dependencies (should not have SPDX headers)
- `tt-inference-server/` - Submodule (external code)
- `.git/` - Git metadata
- `.venv/` - Python virtual environments
- `__pycache__/` - Python cache files
- `.pytest_cache/` - Pytest cache
- `dist/` - Build output
- `build/` - Build artifacts
- `.next/` - Next.js cache
- `coverage/` - Test coverage reports
- `.nyc_output/` - NYC coverage output

### Usage

#### Quick Start

From the project root directory:

```bash
python dev-tools/add_spdx_header.py
```

Or from the dev-tools directory:

```bash
cd dev-tools
python add_spdx_header.py
```

#### Example Output

```
Processing directory: /path/to/project/app/backend
Added SPDX header to: /path/to/project/app/backend/models.py
Added SPDX header to: /path/to/project/app/backend/views.py
Processing directory: /path/to/project/app/frontend
Added SPDX header to: /path/to/project/app/frontend/src/App.tsx
Added SPDX header to: /path/to/project/app/frontend/src/main.tsx
```

### Features

- **Safe to run multiple times** - Won't add duplicate headers
- **Progress feedback** - Shows which files are being processed
- **Multiple file type support** - Handles backend and frontend files
- **Recursive processing** - Scans all subdirectories
- **Error handling** - Gracefully handles file access issues
- **UTF-8 encoding** - Properly handles international characters

### Requirements

- Python 3.6+
- Write permissions to the files being processed
- Run from project root directory or dev-tools directory

### Integration with Development Workflow

This tool is part of the TT-Studio development workflow. For comprehensive development setup instructions, see:

- **[Development Setup](../docs/development.md)** - Initial development environment setup
- **[Contributing Guide](../CONTRIBUTING.md)** - Full contribution workflow and standards
- **[Pre-commit Hooks](../docs/development.md#pre-commit)** - Automated code quality checks

### Pre-commit Integration

The SPDX header tool can be integrated with pre-commit hooks to ensure all new files have proper headers. Add this to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: spdx-headers
        name: Add SPDX headers
        entry: python dev-tools/add_spdx_header.py
        language: system
        pass_filenames: false
        always_run: true
```

### Notes

- Files are processed in-place (no backup copies are created)
- The tool assumes UTF-8 encoding for all files
- Existing SPDX headers are preserved and not duplicated
- The copyright year is automatically set to the current year

### Troubleshooting

**Common Issues:**

1. **Permission Denied**: Ensure you have write permissions to the files
2. **Directory Not Found**: Run from the project root directory
3. **Encoding Errors**: Ensure files are UTF-8 encoded

For more troubleshooting help, see the [project troubleshooting guide](../docs/troubleshooting.md).

---

For more information about the TT-Studio project development workflow, see the [Contributing Guide](../CONTRIBUTING.md).
