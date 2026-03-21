# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from pathlib import Path
from datetime import datetime

from _runner.constants import (
    C_RESET, C_RED, C_GREEN, C_YELLOW, C_BLUE, C_CYAN, C_WHITE,
    C_BOLD,
    TT_STUDIO_ROOT,
)


class SpdxManager:
    def __init__(self):
        pass

    def get_spdx_header_type(self, file_path):
        """
        Determines the appropriate SPDX header type based on file extension.
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

    def get_spdx_headers(self):
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

    def should_skip_spdx_directory(self, directory_path):
        """
        Determines if a directory should be skipped during SPDX processing.
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
            '.nyc_output',
            'frontend',  # Explicitly exclude frontend directory
            'tt-inference-server',  # Exclude submodule
            'tt_studio_persistent_volume',  # Exclude runtime data
            '_runner',  # Exclude this package from self-check (it's added by refactoring)
        }

        return directory_name in skip_dirs

    def add_spdx_header_to_file(self, file_path, headers):
        """
        Adds the SPDX header to the file if it doesn't already contain it.
        """
        header_type = self.get_spdx_header_type(file_path)
        if header_type is None:
            return False

        header = headers[header_type]

        try:
            with open(file_path, "r+", encoding='utf-8') as file:
                content = file.read()
                if "SPDX-License-Identifier" not in content:
                    file.seek(0, 0)
                    file.write(header + "\n" + content)
                    print(f"{C_GREEN}✅ Added SPDX header to: {file_path}{C_RESET}")
                    return True
                else:
                    return False
        except Exception as e:
            print(f"{C_RED}❌ Error processing {file_path}: {e}{C_RESET}")
            return False

    def check_spdx_headers(self):
        """
        Check for missing SPDX headers in the codebase (excluding frontend).
        """
        print(f"{C_BLUE}{C_BOLD}🔍 Checking for missing SPDX license headers...{C_RESET}")

        repo_root = Path(TT_STUDIO_ROOT)
        directories_to_process = [
            repo_root / "app" / "backend",
            repo_root / "app" / "agent",
            repo_root / "app" / "frontend",
            repo_root / "dev-tools",
            repo_root / "models",
            repo_root / "docs",
            repo_root,  # Root level files (like run.py, startup.sh)
        ]

        missing_headers = []
        total_files_checked = 0

        for directory in directories_to_process:
            if not directory.exists():
                print(f"{C_YELLOW}⚠️  Directory does not exist: {directory}{C_RESET}")
                continue

            print(f"{C_CYAN}📁 Checking directory: {directory}{C_RESET}")
            for file_path in directory.rglob("*"):
                if file_path.is_file():
                    # Skip files in excluded directories
                    if any(self.should_skip_spdx_directory(parent) for parent in file_path.parents):
                        continue

                    # Check if the file is a supported type
                    if self.get_spdx_header_type(file_path) is not None:
                        total_files_checked += 1
                        try:
                            with open(file_path, "r", encoding='utf-8') as file:
                                content = file.read()
                                if "SPDX-License-Identifier" not in content:
                                    missing_headers.append(str(file_path))
                        except Exception as e:
                            print(f"{C_YELLOW}⚠️  Could not read {file_path}: {e}{C_RESET}")

        print(f"\n{C_BLUE}📊 SPDX Header Check Results:{C_RESET}")
        print(f"  Total files checked: {total_files_checked}")
        print(f"  Files with missing headers: {len(missing_headers)}")

        if missing_headers:
            print(f"\n{C_RED}{C_BOLD}❌ Files missing SPDX headers:{C_RESET}")
            for file_path in missing_headers:
                print(f"  {C_RED}• {file_path}{C_RESET}")
            print(f"\n{C_CYAN}💡 To add missing headers, run: {C_WHITE}python run.py --add-headers{C_RESET}")
            print(f"   {C_CYAN}or alternatively:{C_RESET}")
            print(f"   {C_CYAN}python3 run.py --add-headers{C_RESET}")
            return False
        else:
            print(f"\n{C_GREEN}{C_BOLD}✅ All files have proper SPDX license headers!{C_RESET}")
            return True

    def add_spdx_headers(self):
        """
        Add missing SPDX headers to all source files (excluding frontend).
        """
        print(f"{C_BLUE}{C_BOLD}📝 Adding missing SPDX license headers...{C_RESET}")

        repo_root = Path(TT_STUDIO_ROOT)
        directories_to_process = [
            repo_root / "app" / "backend",
            repo_root / "app" / "agent",
            repo_root / "dev-tools",
            repo_root / "models",
            repo_root / "docs",
            repo_root,  # Root level files (like run.py, startup.sh)
        ]

        headers = self.get_spdx_headers()
        files_modified = 0
        total_files_checked = 0

        for directory in directories_to_process:
            if not directory.exists():
                print(f"{C_YELLOW}⚠️  Directory does not exist: {directory}{C_RESET}")
                continue

            print(f"{C_CYAN}📁 Processing directory: {directory}{C_RESET}")
            for file_path in directory.rglob("*"):
                if file_path.is_file():
                    # Skip files in excluded directories
                    if any(self.should_skip_spdx_directory(parent) for parent in file_path.parents):
                        continue

                    # Check if the file is a supported type
                    if self.get_spdx_header_type(file_path) is not None:
                        total_files_checked += 1
                        if self.add_spdx_header_to_file(file_path, headers):
                            files_modified += 1

        print(f"\n{C_BLUE}📊 SPDX Header Addition Results:{C_RESET}")
        print(f"  Total files checked: {total_files_checked}")
        print(f"  Files modified: {files_modified}")

        if files_modified > 0:
            print(f"\n{C_GREEN}{C_BOLD}✅ Successfully added SPDX headers to {files_modified} files!{C_RESET}")
        else:
            print(f"\n{C_GREEN}{C_BOLD}✅ All files already have proper SPDX license headers!{C_RESET}")
