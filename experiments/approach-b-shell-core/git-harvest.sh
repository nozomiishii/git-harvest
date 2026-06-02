#!/usr/bin/env sh
# git-harvest (approach B prototype): the single source of truth.
# Handles three cases only: default / --worktree-committed / --yolo.
# The JS layer (bin.mjs) just runs this, or ejects (copies) it verbatim.
#
# Out of scope for this prototype (documented in README): running-session /
# locked protection, .claude/worktrees scope, detached / untouched flags,
# dry-run, multi-OS session paths, cherry-pick (orphan) merge fallback.
set -eu

mode=merged   # worktree threshold: merged (default) | committed
yolo=0
for arg in "$@"; do
  case "$arg" in
    --worktree-committed) mode=committed ;;
    --yolo) yolo=1 ;;
    -h | --help)
      echo "usage: git-harvest [--worktree-committed | --yolo]"
      exit 0
      ;;
    *)
      echo "git-harvest: unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
if [ -z "$base" ]; then
  echo "git-harvest: cannot determine default branch" >&2
  exit 1
fi
main_wt=$(git worktree list --porcelain | awk '/^worktree /{sub(/^worktree /,""); print; exit}')
cur_wt=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
cur_head=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

# merged? real merge (ancestor) OR squash (virtual squash commit + git cherry).
is_merged() {
  b=$1
  if git merge-base --is-ancestor "$b" "$base" 2>/dev/null; then return 0; fi
  mb=$(git merge-base "$base" "$b" 2>/dev/null) || return 1
  sq=$(git commit-tree "$b^{tree}" -p "$mb" -m _ 2>/dev/null) || return 1
  if git cherry "$base" "$sq" 2>/dev/null | grep -q '^+'; then return 1; fi
  return 0
}

# worktrees. sub() (not $2) preserves paths containing spaces.
git worktree list --porcelain | awk '/^worktree /{sub(/^worktree /,""); print}' | while IFS= read -r wt; do
  if [ "$wt" = "$main_wt" ]; then continue; fi
  wtc=$(cd "$wt" 2>/dev/null && pwd -P) || continue
  if [ "$wtc" = "$cur_wt" ]; then continue; fi
  br=$(git -C "$wt" symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ "$br" = "$base" ]; then continue; fi

  if [ "$yolo" = 1 ]; then
    if git worktree remove --force "$wt" 2>/dev/null; then echo "removed worktree: $wt"; fi
    continue
  fi
  if [ -z "$br" ]; then continue; fi # detached: kept in this prototype

  if is_merged "$br"; then
    if git worktree remove "$wt" 2>/dev/null; then echo "removed worktree: $wt"; fi
  elif [ "$mode" = committed ]; then
    if git worktree remove --force "$wt" 2>/dev/null; then echo "removed worktree: $wt"; fi
  fi
done

# branches. base and current HEAD are kept. merged on default; everything on --yolo.
git branch --format='%(refname:short)' | while IFS= read -r b; do
  if [ "$b" = "$base" ]; then continue; fi
  if [ "$b" = "$cur_head" ]; then continue; fi

  if [ "$yolo" = 1 ]; then
    if git branch -D "$b" >/dev/null 2>&1; then echo "removed branch: $b"; fi
  elif is_merged "$b"; then
    if git branch -D "$b" >/dev/null 2>&1; then echo "removed branch: $b"; fi
  fi
done
