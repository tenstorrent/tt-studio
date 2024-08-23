import os

# SPDX header content
SPDX_HEADER = """# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"""

def add_spdx_header(file_path):
    with open(file_path, 'r+') as file:
        content = file.read()
        if "SPDX-License-Identifier" not in content:
            file.seek(0, 0)
            file.write(SPDX_HEADER + "\n" + content)

# Walk through the directory and add the header to all .py files
for root, dirs, files in os.walk("."):
    for file in files:
        if file.endswith(".py"):  # Check if the file is a Python file
            file_path = os.path.join(root, file)  # Construct the file path
            add_spdx_header(file_path)  # Pass the file path to the function
