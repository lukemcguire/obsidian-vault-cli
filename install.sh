#!/bin/bash
# Install obsidian-vault CLI globally via ~/.local/bin symlink
set -e

CLI_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

# Build compiled bundle if not already present
if [ ! -f "$CLI_DIR/dist/index.cjs" ]; then
    echo "Building..."
    (cd "$CLI_DIR" && npm run build)
fi

# Set up XDG config directory
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/obsidian-vault"
mkdir -p "$CONFIG_DIR"

# Auto-migrate legacy .env if config doesn't exist yet
LEGACY_ENV="$CLI_DIR/.env"
NEW_CONFIG="$CONFIG_DIR/config"

if [ -f "$LEGACY_ENV" ] && [ ! -f "$NEW_CONFIG" ]; then
    echo "Migrating config: $LEGACY_ENV → $NEW_CONFIG"
    cp "$LEGACY_ENV" "$NEW_CONFIG"
    echo "  Done. You may delete $LEGACY_ENV"
fi

mkdir -p "$BIN_DIR"
ln -sf "$CLI_DIR/bin/obsidian-vault" "$BIN_DIR/obsidian-vault"

# Verify
if command -v obsidian-vault &>/dev/null; then
    echo "Installed: $(which obsidian-vault)"
else
    echo "Installed to $BIN_DIR/obsidian-vault"
    echo "Add to PATH if not already: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
