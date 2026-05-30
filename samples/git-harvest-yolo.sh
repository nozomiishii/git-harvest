#!/usr/bin/env bash
#
# git-harvest "--yolo" の削除挙動だけを切り出した最小・自己完結スクリプト。
#
# invariant 以外を全部消す（stage 問わず・未コミット込み）:
#   - worktree: main/default-branch・カレント worktree(cwd)・locked・走行中 Claude session 以外を force 削除
#   - branch:   base・現在 HEAD・生存 worktree に checkout 中 以外を -D 削除
#
# 危険: 未コミット変更も未マージ commit も確認なしで消える。
# 本家 git-harvest の --yolo は非対話/hook では --yes 必須・件数警告などの安全弁が付くが、
# これは削除コアのみ。実行前に対象をよく確認すること。
set -euo pipefail

# --- base（default branch）を fail-closed で解決 ---------------------------
resolve_base() {
  local b
  b=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
  if [ -z "$b" ]; then
    git -c http.connectTimeout=3 remote set-head origin --auto >/dev/null 2>&1 || true
    b=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
  fi
  [ -n "$b" ] || {
    echo "git-harvest: cannot determine default branch (try: git remote set-head origin <branch>)" >&2
    exit 1
  }
  echo "$b"
}

canonical_path() { [ -d "$1" ] && (cd "$1" 2>/dev/null && pwd -P) || echo "$1"; }

is_locked_worktree() {
  git worktree list --porcelain | awk -v t="$1" '
    /^worktree / { cur = substr($0, 10) }
    /^locked/    { if (cur == t) f = 1 }
    END          { exit f ? 0 : 1 }'
}

has_running_claude_session() {
  local wt="$1" dir="${GIT_HARVEST_CLAUDE_SESSIONS_DIR:-$HOME/.claude/sessions}" wtc f cwd pid
  [ -d "$dir" ] || return 1
  wtc=$(canonical_path "$wt")
  for f in "$dir"/*.json; do
    [ -f "$f" ] || continue
    cwd=$(sed -nE 's/.*"cwd"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$f" | head -1)
    [ "$(canonical_path "$cwd")" = "$wtc" ] || continue
    pid=$(sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$f" | head -1)
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

base=$(resolve_base)
main_wt=$(git worktree list --porcelain | grep --color=never -m1 '^worktree ' | sed 's/^worktree //')
current_wt=$(canonical_path "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")

# 1) worktree: invariant 以外を force 削除（detached / dirty / 未マージ も問答無用）
while read -r wt; do
  [ "$wt" = "$main_wt" ] && continue
  [ "$(canonical_path "$wt")" = "$current_wt" ] && continue
  branch=$(git -C "$wt" symbolic-ref --short -q HEAD || true)
  [ -n "$branch" ] && [ "$branch" = "$base" ] && continue
  is_locked_worktree "$wt" && continue
  has_running_claude_session "$wt" && continue
  git worktree remove --force "$wt" && echo "removed worktree: $wt" || echo "skip worktree: $wt" >&2
done < <(git worktree list --porcelain | grep --color=never '^worktree ' | sed 's/^worktree //')
git worktree prune

# 2) branch: base / 現在 HEAD / 生存 worktree が参照中 以外を全削除
current_head=$(git symbolic-ref --short -q HEAD || true)
while read -r branch; do
  [ -z "$branch" ] && continue
  [ "$branch" = "$base" ] && continue
  [ "$branch" = "$current_head" ] && continue
  git worktree list --porcelain | grep -qx "branch refs/heads/$branch" && continue
  git branch -D "$branch" >/dev/null 2>&1 && echo "removed branch: $branch" || echo "skip branch: $branch" >&2
done < <(git branch --format='%(refname:short)')
