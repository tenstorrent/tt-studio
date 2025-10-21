# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
SPDX Header Addition Tool

This script automatically adds SPDX license headers to source code files throughout the project.
It supports multiple file types and uses appropriate comment syntax for each.

SUPPORTED FILE TYPES:
- Python files (.py): # comment style
- Shell scripts (.sh): # comment style  
- Dockerfiles: # comment style
- TypeScript/JavaScript (.ts, .tsx, .js, .jsx): // comment style
- CSS files (.css): /* comment */ style
- HTML files (.html, .htm): <!-- comment --> style

DIRECTORIES PROCESSED:
- app/backend/
- app/frontend/

EXCLUDED DIRECTORIES:
- node_modules/ (external dependencies)
- tt-inference-server/ (submodule)

HOW TO RUN:
1. From the project root directory (tt-studio/):
   python dev-tools/add_spdx_header.py

2. Or from the dev-tools directory:
   python add_spdx_header.py

WHAT IT DOES:
- Recursively scans all specified directories
- Skips node_modules and other excluded directories
- Checks each file for existing SPDX headers
- Adds appropriate SPDX header if missing
- Skips files that already have SPDX headers
- Provides progress feedback during execution

EXAMPLE OUTPUT:
Processing directory: /path/to/project/app/backend
Added SPDX header to: /path/to/project/app/backend/models.py
Added SPDX header to: /path/to/project/app/frontend/src/App.tsx
...

REQUIREMENTS:
- Python 3.6+
- Run from project root directory or dev-tools directory
- Write permissions to the files being processed

NOTES:
- The script is safe to run multiple times (won't add duplicate headers)
- Files are processed in-place (backed up versions are not created)
- UTF-8 encoding is assumed for all files
- Automatically excludes node_modules and submodules
"""

from pathlib import Path
from datetime import datetime

current_year = datetime.now().year

# Different header formats for different file types
SPDX_HEADERS = {
    # Python, Bash, Dockerfile
    'hash': f"""# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
    # TypeScript, JavaScript
    'double_slash': f"""// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
    # CSS
    'css': f"""/* SPDX-License-Identifier: Apache-2.0
 *
 * SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
 */
""",
    # HTML
    'html': f"""<!-- SPDX-License-Identifier: Apache-2.0

SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC -->
"""
}

def get_header_type(file_path):
    """
    Determines the appropriate header type based on file extension.
    """
    suffix = file_path.suffix.lower()
    name = file_path.name
    
    if suffix in ('.py', '.sh') or name == 'Dockerfile':
        return 'hash'
    elif suffix in ('.ts', '.tsx', '.js', '.jsx'):
        return 'double_slash'
    elif suffix == '.css':
        return 'css'
    elif suffix in ('.html', '.htm'):
        return 'html'
    else:
        return None

def add_spdx_header(file_path):
    """
    Adds the SPDX header to the file if it doesn't already contain it.
    """
    header_type = get_header_type(file_path)
    if header_type is None:
        return
    
    header = SPDX_HEADERS[header_type]
    
    try:
        with open(file_path, "r+", encoding='utf-8') as file:
            content = file.read()
            if "SPDX-License-Identifier" not in content:
                file.seek(0, 0)
                file.write(header + "\n" + content)
                print(f"Added SPDX header to: {file_path}")
    except Exception as e:
        print(f"Error processing {file_path}: {e}")

def should_skip_directory(directory_path):
    """
    Determines if a directory should be skipped during processing.
    """
    directory_name = directory_path.name
    
    # Skip common directories that shouldn't have SPDX headers
    skip_dirs = {
        'node_modules',
        '.git',
        '.venv',
        '__pycache__',
        '.pytest_cache',
        'dist',
        'build',
        '.next',
        'coverage',
        '.nyc_output'
    }
    
    return directory_name in skip_dirs

if __name__ == "__main__":
    # Define the repo root and directories to process
    repo_root = Path(__file__).resolve().parent.parent
    app_dir = repo_root / "app"
    
    # Process all subdirectories in app/ except frontend
    directories_to_process = []
    if app_dir.exists():
        for subdir in app_dir.iterdir():
            if subdir.is_dir() and subdir.name != "frontend":
                directories_to_process.append(subdir)

    # Walk through the directories and add the header to relevant files
    for directory in directories_to_process:
        if not directory.exists():
            print(f"Directory does not exist: {directory}")
            continue
            
        print(f"Processing directory: {directory}")
        for file_path in directory.rglob("*"):
            if file_path.is_file():
                # Skip files in excluded directories
                if any(should_skip_directory(parent) for parent in file_path.parents):
                    continue
                    
                # Check if the file is a supported type
                if get_header_type(file_path) is not None:
                    add_spdx_header(file_path)
