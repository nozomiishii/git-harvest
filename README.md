# git-harvest

English | [日本語](./README.ja.md)

Clean up merged branches and worktrees (supports squash merges).

## Install

### Shell (macOS/Linux) (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/install.sh | bash
```

Restart your terminal or run `source ~/.zshrc` to start using git-harvest.

### Homebrew

```sh
brew install nozomiishii/tap/git-harvest
```

### (Optional) Set up aliases

Set up aliases for quicker access. You can use both or just the one you prefer:

`ghv`
```sh
# Shell alias
echo "alias ghv='git-harvest'" >> ~/.zshrc
```

`git harvest`
```sh
# Git subcommand — run as `git harvest`
git config --global alias.harvest '!git-harvest'
```


## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/uninstall.sh | bash
```

## Run directly without installing

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

## Recommended workflow

By combining with Git hooks' post-merge command, you can automatically harvest after every merge or pull.

### With [lefthook](https://github.com/evilmartians/lefthook)

There are many Git hook tools such as husky, pre-commit, and simple-git-hooks, but Lefthook is recommended because it is language-agnostic and easy to integrate into monorepos. Additionally, by using lefthook-local.yaml, you can run hooks only for yourself without affecting other team members.


```yaml
# lefthook-local.yaml
post-merge:
  commands:
    git-harvest:
      run: npx -y git-harvest@latest
      # or: bunx git-harvest@latest
      # or: pnpx git-harvest@latest
```


## What it does

1. Detects the default branch (main/master) from `origin/HEAD`
2. Finds local branches already merged into the default branch (including squash merges)
3. Removes worktrees associated with merged branches
4. Deletes the merged branches
5. Prunes stale remote-tracking references (`git fetch --prune`)

### Status display

git-harvest shows the status of all worktrees and branches.

#### Worktrees

| State | Display | Description | Action |
|---|---|---|---|
| Merged + clean | `[DELETED]` / `[WILL DELETE]` | Ready to harvest | Remove |
| Merged + uncommitted changes | `[GROWING] (uncommitted changes)` | Has unsaved work, skipped | Keep |
| Not merged | `[GROWING] (not merged)` | Not yet merged | Keep |
| No unique commits | `[GROWING] (no unique commits)` | Just created, no work started yet | Keep |
| Main working tree | *(not shown)* | Always excluded | Keep |
| Default branch | *(not shown)* | Always excluded | Keep |

#### Branches

| State | Display | Description | Action |
|---|---|---|---|
| Merged + deletable | `[DELETED]` / `[WILL DELETE]` | Ready to harvest | Remove |
| Merged + currently checked out | `[GROWING] (currently checked out)` | Currently in use, skipped | Keep |
| Not merged | `[GROWING] (not merged)` | Not yet merged | Keep |
| No unique commits | `[GROWING] (no unique commits)` | Just created, no work started yet | Keep |
| Default branch | *(not shown)* | Always excluded | Keep |

### Squash merge detection

Uses `git commit-tree` to create a virtual squash commit and `git cherry` to check if the result is already included in the default branch. This correctly detects squash merges, which `git branch --merged` cannot.
