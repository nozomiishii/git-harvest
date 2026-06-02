#!/usr/bin/env sh
# Behavioral test for approach B: build a real fixture repo, run the single
# source-of-truth shell, assert end state. This is the only test layer the
# shell-source approach gets (no typed unit tests).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

gh() { sh "$here/git-harvest.sh" "$@" >/dev/null; }
has_branch() { git show-ref --verify --quiet "refs/heads/$1"; }
fail() {
  echo "FAIL: $1"
  exit 1
}

# origin + clone so origin/HEAD resolves like a real checkout.
git init -q --bare "$tmp/origin.git"
git clone -q "$tmp/origin.git" "$tmp/repo"
cd "$tmp/repo"
git config user.email t@t.t
git config user.name t
git config commit.gpgsign false
echo a > a
git add a
git commit -qm init
git push -q origin HEAD:main
git remote set-head origin main
git branch -m main

# feat-merged: squash-merged into main (content is in base).
git checkout -qb feat-merged
echo b > b
git add b
git commit -qm work
git checkout -q main
git merge -q --squash feat-merged
git commit -qm squash
git push -q
# feat-open: real unmerged commits.
git checkout -qb feat-open
echo c > c
git add c
git commit -qm open
git checkout -q main
git worktree add -q "$tmp/wt-merged" feat-merged
git worktree add -q "$tmp/wt-open" feat-open

# default: merged worktree + merged branch go; the open ones stay.
gh
has_branch feat-merged && fail "default kept merged branch"
has_branch feat-open || fail "default deleted the unmerged branch"
[ -d "$tmp/wt-open" ] || fail "default deleted the unmerged worktree"
echo "PASS: default removes only merged"

# --worktree-committed: lowers the worktree threshold; the open worktree goes,
# but the open branch (not merged) stays — branch threshold is unchanged.
gh --worktree-committed
[ -d "$tmp/wt-open" ] && fail "--worktree-committed kept the committed worktree"
has_branch feat-open || fail "--worktree-committed wrongly deleted the open branch"
echo "PASS: --worktree-committed removes the committed worktree, keeps its branch"

# --yolo: everything non-invariant goes.
gh --yolo
has_branch feat-open && fail "--yolo kept the open branch"
echo "PASS: --yolo removes everything left"

echo "ALL PASS"
