# git-harvest

English | [日本語](./README.ja.md)

<br>
<div align="center">
  <img src="demo/logo.gif" alt="logo" width="480" />
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/git-harvest"><img src="https://img.shields.io/npm/v/git-harvest.svg" alt="npm version" /></a>
</p>
<br>

Clean up branches and worktrees automatically, by their commit lifecycle stage.

## Try it (`--dry-run`)

Shows what would be deleted without deleting anything:

```sh
npx -y git-harvest@latest --dry-run
```

## Run directly without installing (recommended)

Always runs the latest version, so there is nothing to update.

```sh
# npm
npx -y git-harvest@latest

# pnpm
pnpx git-harvest@latest

# bun
bunx git-harvest@latest
```

### (Optional) Set up aliases

```sh
# normal (default = delete merged only)
echo "alias ghv='npx -y git-harvest@latest'" >> ~/.zshrc
# sweep (--yolo = delete uncommitted and detached too)
echo "alias 'ghv!'='npx -y git-harvest@latest --yolo'" >> ~/.zshrc
```

`git harvest`

```sh
# git subcommand — run as `git harvest` (no install)
git config --global alias.harvest '!npx -y git-harvest@latest'
# or: git config --global alias.harvest '!pnpx git-harvest@latest'
# or: git config --global alias.harvest '!bunx git-harvest@latest'
```

## Recommended usage

Pair it with a Git post-merge hook to harvest automatically on every merge or pull.

### With [lefthook](https://github.com/evilmartians/lefthook)

There are many Git Hooks tools (husky, pre-commit, simple-git-hooks), but Lefthook is language-agnostic and easy to drop into a monorepo. With `lefthook-local.yaml` you can run it only for yourself without affecting teammates.

```yaml
# lefthook-local.yaml
post-merge:
  commands:
    git-harvest:
      run: npx -y git-harvest@latest
      # or: pnpx git-harvest@latest
      # or: bunx git-harvest@latest
```

## Usage

```sh
npx -y git-harvest@latest
```

### Options

```
-h, --help                   Show help
-v, --version                Show version
-n, --dry-run                Show what would be deleted without deleting

--committed[=<scope>]        Lower the threshold to committed (delete committed + merged; keep uncommitted)
--files-changed[=<scope>]    Lower the threshold to files-changed (delete uncommitted too; worktree scopes only)
--untouched                  Also delete untouched worktrees (no work, identical to base)
--detached                   Also delete detached worktrees (no branch)
                             WARNING: a detached worktree's commits are unreachable -- removal can lose them permanently (no reflog recovery)
--yolo                       Preset: --files-changed --committed --untouched --detached (all scopes)

logo                         Show the logo
```

`<scope>` is `worktree` / `claude-worktree` / `branch`. When omitted it applies to all applicable scopes. List multiple scopes comma-separated (`--committed=worktree,branch`) or by repeating the flag. `--files-changed` has no branch stage, so it applies to worktree scopes only.

## How it works

### Stages (risky → safe)

git-harvest classifies each worktree / branch by its most at-risk stage.

```
files-changed   →   committed   →   merged
uncommitted         committed        merged into base
unrecoverable       reflog recovery  fully safe
```

A flag lowers the threshold and deletes that stage and everything safer. The default deletes `merged` only — the most conservative choice, safe even in a post-merge hook.

For example, `--committed` deletes committed and merged while keeping uncommitted work; `--files-changed` deletes uncommitted work too.

### Scopes (narrowing the target)

| scope | target |
|---|---|
| `worktree` | worktrees on a normal path (human-made checkouts) |
| `claude-worktree` | worktrees under `.claude/worktrees/` |
| `branch` | branches |

Thresholds are kept per scope. `--committed` affects every scope; `--committed=claude-worktree` affects only that scope.

### Off-ladder (outside the stages, protected by default)

| state | definition | default | delete |
|---|---|---|---|
| `untouched` | clean and no unique commits (identical to base) | kept | `--untouched` / `--yolo` |
| `detached` | a worktree with no branch (detached HEAD) | kept | `--detached` / `--yolo` |

An untouched branch is just a ref identical to base, so it is deleted by default — asymmetric with worktrees on purpose (a worktree signals intent to use it; a branch is residue to sweep).

> WARNING: a detached worktree's commits have no branch ref, and removing the worktree deletes its reflog with it — they can be lost permanently (no reflog recovery). Only `--detached` / `--yolo` target them.

### Status markers

| marker | meaning |
|---|---|
| `✓` | deleted |
| `→` | would delete (dry-run) |
| `·` | kept (reason on the right) |
| `✗` | failed to delete |

```
Worktrees
  ·  ~/.claude/worktrees/foo        untouched      identical to base, no work
  ·  ~/repo-hotfix                  detached       no branch
  ·  ~/.claude/worktrees/bar        committed      below the threshold (merged), kept
  ✓  ~/.claude/worktrees/done

Branches
  ·  feature/wip                    committed      below the threshold, kept
  ✓  feature/done
```

The keep reason is a state label (files-changed / committed / untouched / detached) or an invariant reason.

### Invariants (always protected — no flag or `--yolo` overrides them)

- the main / default worktree
- the worktree on the base branch (`base branch`)
- the worktree of the current working directory (`current`)
- a locked worktree (`git worktree lock`)
- a worktree with a running agent session (`session running`)
- the current HEAD branch (`current HEAD`)
- a branch checked out in a surviving worktree (`checked out`)

### Claude Code integration

git-harvest detects running [Claude Code](https://claude.ai/code) sessions and protects their worktrees.

| path | purpose |
|---|---|
| `~/.claude/sessions/<pid>.json` | detect a running session (match the worktree by `cwd` + confirm the process with `kill -0 pid`) |

Worktrees under `.claude/worktrees/` are treated as the `claude-worktree` scope and judged by the same stage thresholds as normal worktrees (always protected while a session is running). Use a scope, e.g. `--committed=claude-worktree`, to lower the threshold for claude worktrees only.

A "running session" is decided solely by whether a local process is active (a matching `~/.claude/sessions/<pid>.json`). It ignores Remote Control's iPhone status (Connected / Disconnected / Archived). The conversation history (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) survives even when the worktree is removed, so `claude --resume <session-id>` resumes where you left off.

Environment variable to override the path (for tests or non-standard installs):

| variable | default |
|---|---|
| `GIT_HARVEST_CLAUDE_SESSIONS_DIR` | `~/.claude/sessions` |
