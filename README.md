# git-harvest

English | [日本語](./README.ja.md)

Clean up merged branches and worktrees (supports squash merges).

## Install

### Shell (macOS/Linux) (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/install.sh | bash
```

Restart your terminal or run `source ~/.zshrc` to start using git-harvest.

Set up aliases for quicker access. You can use both or just the one you prefer:

```sh
# Shell alias
echo "alias ghv='git-harvest'" >> ~/.zshrc

# Git subcommand — run as `git harvest`
git config --global alias.harvest '!git-harvest'
```

### Homebrew

```sh
brew install nozomiishii/tap/git-harvest
```

#### Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/uninstall.sh | bash
```

### npm

Run directly without installing:

```sh
# bun
bunx git-harvest@latest

# pnpm
pnpx git-harvest@latest

# npm
npx -y git-harvest@latest
```

## Usage

```sh
git-harvest
```

### Options

```sh
git-harvest --help     # Show help
git-harvest --version  # Show version
```

## What it does

1. Detects the default branch (main/master) from `origin/HEAD`
2. Finds local branches already merged into the default branch (including squash merges)
3. Removes worktrees associated with merged branches
4. Deletes the merged branches
5. Prunes stale remote-tracking references

### Squash merge detection

Uses `git commit-tree` to create a virtual squash commit and `git cherry` to check if the result is already included in the default branch. This correctly detects squash merges, which `git branch --merged` cannot.

## With lefthook

```yaml
# lefthook.yaml
post-merge:
  commands:
    cleanup-merged:
      run: pnpx git-harvest@latest
      # or: bunx git-harvest@latest
      # or: npx -y git-harvest@latest
```
