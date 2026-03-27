#!/usr/bin/env bash
# git-harvest — uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/uninstall.sh | bash
set -euo pipefail

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

# ---------------------------------------------------------------------------
# Confirm before uninstalling
# ---------------------------------------------------------------------------
confirm_uninstall() {
  echo "The following will be removed:"
  echo "  Binary: $BIN_DIR/git-harvest"
  echo "  Shell:  git-harvest block in ~/.zshrc"
  echo ""

  local answer=""
  if [ -t 0 ]; then
    read -rp "Continue? [Y/n] " answer
  elif [ -e /dev/tty ]; then
    read -rp "Continue? [Y/n] " answer < /dev/tty
  fi

  case "$answer" in
    [nN]*) echo "Aborted."; exit 0 ;;
  esac
}

# ---------------------------------------------------------------------------
# Remove binary
# ---------------------------------------------------------------------------
remove_binary() {
  if [ -f "$BIN_DIR/git-harvest" ]; then
    rm -f "$BIN_DIR/git-harvest"
    echo "Removed $BIN_DIR/git-harvest"
  else
    echo "Binary not found: $BIN_DIR/git-harvest (skipped)"
  fi
}

# ---------------------------------------------------------------------------
# Remove git-harvest block from .zshrc
# ---------------------------------------------------------------------------
unconfigure_shell() {
  local zshrc="$HOME/.zshrc"
  local marker='# git-harvest'

  if [ ! -f "$zshrc" ]; then
    echo "No .zshrc found (skipped)"
    return
  fi

  if ! grep -qF "$marker" "$zshrc"; then
    echo "No git-harvest configuration found in $zshrc (skipped)"
    return
  fi

  local tmp
  tmp="$(mktemp)"

  # Delete the block: comment line through export line
  sed '/^# git-harvest$/,/^export PATH=.*\.local\/bin.*$/d' "$zshrc" > "$tmp"

  # Squeeze consecutive blank lines
  cat -s "$tmp" > "$zshrc"
  rm -f "$tmp"

  echo "Removed git-harvest configuration from $zshrc"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  confirm_uninstall
  remove_binary
  unconfigure_shell

  echo ""
  echo "git-harvest was uninstalled successfully!"
  echo ""
  echo "Restart your terminal to apply changes."
}

main
