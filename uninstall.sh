#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

set -e

INSTALL_DIR="${HOME}/.local/bin"
SYMLINK_PATH="${INSTALL_DIR}/tt-studio"

echo "🗑️  Uninstalling TT Studio CLI..."
echo ""

# Check if symlink exists
if [ ! -L "$SYMLINK_PATH" ]; then
    echo "⚠️  tt-studio is not installed at ${SYMLINK_PATH}"
    echo "   Nothing to uninstall"
    exit 1
fi

# Remove symlink
echo "🔗 Removing symlink: ${SYMLINK_PATH}"
rm "$SYMLINK_PATH"

echo "✅ Uninstallation complete!"
echo ""
echo "You can still use './tt-studio' from the repository directory"
