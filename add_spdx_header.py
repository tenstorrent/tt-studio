# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

from pathlib import Path
from datetime import datetime

current_year = datetime.now().year

SPDX_HEADER = f"""# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © {current_year} Tenstorrent AI ULC
"""

def add_spdx_header(file_path):
    """
    Adds the SPDX header to the file if it doesn't already contain it.
    """
    with open(file_path, "r+") as file:
        content = file.read()
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

    # Walk through the directories and add the header to relevant files
    for directory in directories_to_process:
        for file_path in directory.rglob("*"):
            # Check if the file is a Python file, Bash script, or Dockerfile
            if file_path.suffix in (".py", ".sh") or file_path.name == "Dockerfile":
                add_spdx_header(file_path)
