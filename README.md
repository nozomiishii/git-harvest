# git-harvest

English | [日本語](./README.ja.md)

<br>
<div align="center">
  <img src="demo/logo.gif" alt="logo" width="480" />
</div>
<br>

Clean up branches and worktrees.


## Run directly without installing

```sh
# bun
bunx git-harvest@latest

# pnpm
pnpx git-harvest@latest

# npm
npx -y git-harvest@latest
```

### (Optional) Set up aliases

```sh
# bun
echo "alias ghv='bunx git-harvest@latest'" >> ~/.zshrc
echo "alias 'ghv!'='bunx git-harvest@latest --all'" >> ~/.zshrc

# pnpm
echo "alias ghv='pnpx git-harvest@latest'" >> ~/.zshrc
echo "alias 'ghv!'='pnpx git-harvest@latest --all'" >> ~/.zshrc

# npm
echo "alias ghv='npx -y git-harvest@latest'" >> ~/.zshrc
echo "alias 'ghv!'='npx -y git-harvest@latest --all'" >> ~/.zshrc
```

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

`ghv` / `ghv!`
```sh
# Shell alias
echo "alias ghv='git-harvest'" >> ~/.zshrc
echo "alias 'ghv!'='git-harvest --all'" >> ~/.zshrc
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

## Usage

```sh
git-harvest
```

### Options

```sh
git-harvest --help     # Show help
git-harvest --version  # Show version
git-harvest --dry-run  # Show what would be deleted without actually deleting
git-harvest --all      # Delete all branches and worktrees except the default branch
git-harvest logo       # Show the git-harvest logo
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

### Worktrees

| State | Display | Default | `--all` |
|---|---|---|---|
| Merged + clean | `[DELETED]` / `[WILL DELETE]` | Delete | Delete |
| Merged + uncommitted changes | `[GROWING] (uncommitted changes)` | Keep | Delete |
| Not merged | `[GROWING] (not merged)` | Keep | Delete |
| No unique commits | `[GROWING] (no unique commits)` | Keep | Delete |
| Main working tree | *(not shown)* | Keep | Keep |

### Branches

| State | Display | Default | `--all` |
|---|---|---|---|
| Merged | `[DELETED]` / `[WILL DELETE]` | Delete | Delete |
| Merged + checked out | `[GROWING] (currently checked out)` | Keep | Error |
| Not merged | `[GROWING] (not merged)` | Keep | Delete |
| No unique commits | `[DELETED]` / `[WILL DELETE]` | Delete | Delete |
| Default branch | *(not shown)* | Keep | Keep |

> `--all` exits with an error if a non-default branch is currently checked out. `--dry-run --all` shows all resources as `[WILL DELETE]` without errors.

