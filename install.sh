#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
SYMLINK_PATH="${INSTALL_DIR}/tt-studio"
TARGET_SCRIPT="${SCRIPT_DIR}/tt-studio"

echo "🚀 Installing TT Studio CLI..."
echo ""

# Create install directory if it doesn't exist
if [ ! -d "$INSTALL_DIR" ]; then
    echo "📁 Creating ${INSTALL_DIR}..."
    mkdir -p "$INSTALL_DIR"
fi

# Check if symlink already exists
if [ -L "$SYMLINK_PATH" ]; then
    echo "⚠️  tt-studio is already installed at ${SYMLINK_PATH}"
    echo "   Run ./uninstall.sh first if you want to reinstall"
    exit 1
fi

# Create symlink
echo "🔗 Creating symlink: ${SYMLINK_PATH} -> ${TARGET_SCRIPT}"
ln -s "$TARGET_SCRIPT" "$SYMLINK_PATH"

echo "✅ Installation complete!"
echo ""

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
    echo "⚠️  Warning: ${INSTALL_DIR} is not in your PATH"
    echo ""
    echo "Add this line to your shell config (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "Then restart your shell or run: source ~/.zshrc (or ~/.bashrc)"
else
    echo "✨ You can now use 'tt-studio' from anywhere!"
    echo ""
    echo "Try it:"
    echo "  tt-studio --help"
    echo "  tt-studio tests build"
fi
