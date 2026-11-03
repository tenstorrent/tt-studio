# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""SPDX license-header checking and insertion."""

from pathlib import Path
from datetime import datetime
from rich.table import Table
from rich.text import Text
from tt_setup.constants import *
from tt_setup.console import console, notice_panel


def get_spdx_header_type(file_path):
    """
    Determines the appropriate SPDX header type based on file extension.
    """
    suffix = file_path.suffix.lower()
    name = file_path.name
    
    if suffix in ('.py', '.sh') or name == 'Dockerfile':
        return 'hash'
    elif suffix in ('.ts', '.tsx', '.js', '.jsx', '.rs'):
        return 'double_slash'
    elif suffix == '.css':
        return 'css'
    elif suffix in ('.html', '.htm'):
        return 'html'
    else:
        return None


def get_spdx_headers():
    """
    Returns SPDX header templates for different file types.
    """
    current_year = datetime.now().year
    
    return {
        # Python, Bash, Dockerfile
        'hash': f"""# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
""",
        # TypeScript, JavaScript, Rust
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


def should_skip_spdx_directory(directory_path):
    """
    Determines if a directory should be skipped during SPDX processing.
    """
    directory_name = directory_path.name
    
    # Skip common directories that shouldn't have SPDX headers
    skip_dirs = {
        'node_modules',
        '.git',
        '.venv',
        '.tt_studio_run_venv',  # the launcher's managed venv — never add headers here
        '__pycache__',
        '.pytest_cache',
        'dist',
        'build',
        '.next',
        'coverage',
        '.nyc_output',
        'frontend',  # Explicitly exclude frontend directory
        'tt-inference-server',  # Exclude (no longer used, replaced by artifact)
        '.artifacts',  # Downloaded inference-server artifact — not our source
        'logs',  # Host-side runtime logs
        'target',  # Cargo build output (desktop/src-tauri/target)
        'gen',  # Tauri generated schemas (desktop/src-tauri/gen)
        'tt_studio_persistent_volume',  # Exclude runtime data
    }
    
    return directory_name in skip_dirs


def _is_spdx_candidate(file_path):
    """True if `file_path` is a file we should check/add an SPDX header on:
    a supported source type, not inside a skipped directory."""
    if not file_path.is_file():
        return False
    if any(should_skip_spdx_directory(parent) for parent in file_path.parents):
        return False
    return get_spdx_header_type(file_path) is not None


def _iter_spdx_files(repo_root):
    """Yield the source files eligible for SPDX processing, each exactly once.

    The tracked subtrees are walked recursively; the repo root itself is scanned
    non-recursively so root-level files (run.py, startup.sh, …) are covered
    without descending the whole tree (node_modules, .git, .venv) — which also
    avoids processing files under the subtrees twice."""
    subtrees = [
        repo_root / "app" / "backend",
        repo_root / "app" / "agent",
        repo_root / "desktop",
        repo_root / "dev-tools",
        repo_root / "models",
        repo_root / "docs",
    ]
    seen = set()
    for directory in subtrees:
        if not directory.exists():
            continue
        for file_path in directory.rglob("*"):
            if file_path not in seen and _is_spdx_candidate(file_path):
                seen.add(file_path)
                yield file_path
    # Root-level files only (non-recursive).
    for file_path in repo_root.iterdir():
        if file_path not in seen and _is_spdx_candidate(file_path):
            seen.add(file_path)
            yield file_path


def add_spdx_header_to_file(file_path, headers):
    """
    Adds the SPDX header to the file if it doesn't already contain it.
    """
    header_type = get_spdx_header_type(file_path)
    if header_type is None:
        return False
    
    header = headers[header_type]
    
    try:
        with open(file_path, "r+", encoding='utf-8') as file:
            content = file.read()
            if "SPDX-License-Identifier" not in content:
                file.seek(0, 0)
                # Preserve a leading shebang: inserting the SPDX block at byte 0
                # would push `#!/usr/bin/env …` off line 1 and break execution.
                if content.startswith("#!"):
                    shebang, _, rest = content.partition("\n")
                    file.write(shebang + "\n" + header + "\n" + rest)
                else:
                    file.write(header + "\n" + content)
                console.print(f"[success]✅ Added SPDX header to: {file_path}[/success]")
                return True
            else:
                return False
    except Exception as e:
        console.print(f"[error]❌ Error processing {file_path}: {e}[/error]")
        return False


def check_spdx_headers():
    """
    Check for missing SPDX headers in the codebase (excluding frontend).
    """
    console.print("[info]🔍 Checking for missing SPDX license headers...[/info]")

    repo_root = Path(TT_STUDIO_ROOT)

    missing_headers = []
    total_files_checked = 0

    for file_path in _iter_spdx_files(repo_root):
        total_files_checked += 1
        try:
            with open(file_path, "r", encoding='utf-8') as file:
                content = file.read()
                if "SPDX-License-Identifier" not in content:
                    missing_headers.append(str(file_path))
        except Exception as e:
            console.print(f"[muted]⚠️  Could not read {file_path}: {e}[/muted]")

    if missing_headers:
        summary = [
            f"[muted]Total files checked:[/muted] {total_files_checked}",
            f"[warning]Files with missing headers:[/warning] {len(missing_headers)}",
            "",
            "[muted]To add missing headers, run:[/muted] python run.py --add-headers",
        ]
        console.print(notice_panel(
            "[warning]❌ Missing SPDX headers[/warning]",
            summary,
            border_style="warning",
        ))
        missing_table = Table(box=None, show_header=True, header_style="bold")
        missing_table.add_column("File missing SPDX header", style="error")
        for file_path in missing_headers:
            missing_table.add_row(Text(file_path))
        console.print(missing_table)
        return False
    else:
        console.print(notice_panel(
            "[success]✅ SPDX headers[/success]",
            [
                f"[muted]Total files checked:[/muted] {total_files_checked}",
                "[success]All files have proper SPDX license headers![/success]",
            ],
            border_style="success",
        ))
        return True


def add_spdx_headers():
    """
    Add missing SPDX headers to all source files (excluding frontend).
    """
    console.print("[info]📝 Adding missing SPDX license headers...[/info]")

    repo_root = Path(TT_STUDIO_ROOT)

    headers = get_spdx_headers()
    files_modified = 0
    total_files_checked = 0

    for file_path in _iter_spdx_files(repo_root):
        total_files_checked += 1
        if add_spdx_header_to_file(file_path, headers):
            files_modified += 1

    if files_modified > 0:
        result_line = f"[success]Successfully added SPDX headers to {files_modified} files![/success]"
    else:
        result_line = "[success]All files already have proper SPDX license headers![/success]"
    console.print(notice_panel(
        "[success]📊 SPDX Header Addition Results[/success]",
        [
            f"[muted]Total files checked:[/muted] {total_files_checked}",
            f"[muted]Files modified:[/muted] {files_modified}",
            "",
            result_line,
        ],
        border_style="success",
    ))
