# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from pathlib import Path

# SPDX header content
SPDX_HEADER = """# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"""

def add_spdx_header(file_path):
    """
    Adds the SPDX header to the file if it doesn't already contain it.
    """
    with open(file_path, "r+") as file:
        content = file.read()
        # print(content)
        if "SPDX-License-Identifier" not in content:
            file.seek(0, 0)
            file.write(SPDX_HEADER + "\n" + content)

if __name__ == "__main__":
    # Define the repo root and directories to process
    repo_root = Path(__file__).resolve().parent.parent
    directories_to_process = [
        repo_root / "tt-studio/app/api",
        repo_root / "tt-studio/models",
    ]
    
    # print(f"Processing directories: {directories_to_process}")

    # Walk through the directories and add the header to relevant files
    for directory in directories_to_process:
        for file_path in directory.rglob("*"):
            # print(file_path)
            # Check if the file is a Python file, Bash script, or Dockerfile
            if file_path.suffix in (".py", ".sh") or file_path.name == "Dockerfile":
                # print(f"Adding SPDX header to: {file_path}")
                add_spdx_header(file_path)
