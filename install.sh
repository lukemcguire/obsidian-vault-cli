#!/bin/bash
# Install obsidian-vault CLI globally via ~/.local/bin symlink
set -e

CLI_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

mkdir -p "$BIN_DIR"
ln -sf "$CLI_DIR/bin/obsidian-vault" "$BIN_DIR/obsidian-vault"

# Verify
if command -v obsidian-vault &>/dev/null; then
    echo "Installed: $(which obsidian-vault)"
else
    echo "Installed to $BIN_DIR/obsidian-vault"
    echo "Add to PATH if not already: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
