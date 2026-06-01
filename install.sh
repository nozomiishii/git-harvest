#!/usr/bin/env bash
# git-harvest — installer
# Usage: curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/install.sh | bash
set -euo pipefail

REPO="nozomiishii/git-harvest"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

# ---------------------------------------------------------------------------
# Require Apple Silicon Mac (this installer ships a darwin-arm64 standalone binary)
# ---------------------------------------------------------------------------
require_apple_silicon() {
  if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
    echo "Error: this standalone binary is for Apple Silicon Macs only." >&2
    echo "For Intel Mac / Linux / others, please use npm:" >&2
    echo "  npm i -g git-harvest" >&2
    echo "  (or: npx git-harvest / pnpm dlx git-harvest / bunx git-harvest)" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Download script from GitHub Releases
# ---------------------------------------------------------------------------
download() {
  local version="${GIT_HARVEST_VERSION:-latest}"
  local base_url

  if [ "$version" = "latest" ]; then
    base_url="https://github.com/${REPO}/releases/latest/download"
  else
    base_url="https://github.com/${REPO}/releases/download/${version}"
  fi

  local binary_url="${base_url}/git-harvest-darwin-arm64"

  mkdir -p "$BIN_DIR"

  echo "Downloading git-harvest..."

  if command -v curl >/dev/null; then
    curl -fsSL "$binary_url" -o "$BIN_DIR/git-harvest"
  elif command -v wget >/dev/null; then
    wget -qO "$BIN_DIR/git-harvest" "$binary_url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi

  chmod +x "$BIN_DIR/git-harvest"
}

# ---------------------------------------------------------------------------
# Configure shell (.zshrc)
# ---------------------------------------------------------------------------
configure_shell() {
  local zshrc="$HOME/.zshrc"
  # shellcheck disable=SC2016
  local marker='# git-harvest'

  # Skip if already configured
  if [ -f "$zshrc" ] && grep -qF "$marker" "$zshrc"; then
    echo "Shell already configured in $zshrc"
    return
  fi

  local config_block
  config_block=$(cat <<'BLOCK'

# git-harvest
export PATH="${XDG_BIN_HOME:-$HOME/.local/bin}:$PATH"
BLOCK
)

  if [ -f "$zshrc" ]; then
    echo "$config_block" >> "$zshrc"
  else
    echo "$config_block" > "$zshrc"
  fi

  echo "Added git-harvest configuration to $zshrc"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  require_apple_silicon
  download
  configure_shell

  echo ""
  echo "git-harvest was installed successfully!"
  echo "  Binary: $BIN_DIR/git-harvest"
  echo ""
  echo "Set up aliases for quicker access."
  echo "You can use both or just the one you prefer:"
  echo ""
  echo "  # Shell alias"
  echo "  echo \"alias ghv='git-harvest'\" >> ~/.zshrc"
  echo ""
  echo "  # Git subcommand — run as 'git harvest'"
  echo "  git config --global alias.harvest '!git-harvest'"
  echo ""
  echo "Restart your terminal or run:"
  echo "  source ~/.zshrc"
  echo ""
}

main
