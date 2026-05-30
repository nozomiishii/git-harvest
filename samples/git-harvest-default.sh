#!/usr/bin/env bash
#
# git-harvest "default" の削除挙動だけを切り出した最小・自己完結スクリプト。
#
# 削除するもの:
#   - worktree: merge済 かつ clean なものだけ
#   - branch:   独自コミットが base にある（merge済 / untouched）もの
# 保護するもの（invariant）:
#   - main/default-branch の worktree・カレント worktree(cwd)・locked・走行中 Claude session
#   - base branch・現在 HEAD・生存 worktree に checkout 中の branch
#   - untouched な worktree（base と同一で未着手 = 使うために作った checkout なので残す）
#
# これは削除コアのみ。本家 git-harvest の dry-run / 色 / --help / 個別 flag /
# 出力整形 / fail-safe 集計などは載っていない。会社などで個人ライブラリに依存せず
# 同じ掃除をしたい時のコピペ用リファレンス。
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

# パスを canonical 化（symlink 解決。例 macOS /var -> /private/var）
canonical_path() { [ -d "$1" ] && (cd "$1" 2>/dev/null && pwd -P) || echo "$1"; }

# worktree に未コミットの変更があるか（0 = dirty）
has_uncommitted_changes() {
  local wt="$1"
  git -C "$wt" diff --quiet HEAD 2>/dev/null || return 0
  git -C "$wt" diff --quiet --cached 2>/dev/null || return 0
  [ -n "$(git -C "$wt" ls-files --others --exclude-standard 2>/dev/null)" ] && return 0
  return 1
}

# worktree が git worktree lock されているか（0 = locked）
is_locked_worktree() {
  git worktree list --porcelain | awk -v t="$1" '
    /^worktree / { cur = substr($0, 10) }
    /^locked/    { if (cur == t) f = 1 }
    END          { exit f ? 0 : 1 }'
}

# この worktree で走行中の Claude session があるか（0 = あり）
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

# branch を base に対して分類する: untouched / merged / other。
# 4 段階フォールバック（first-parent / ancestor / 仮想 squash / cherry-pick）。
#   untouched = 独自コミットなし（HEAD が base の first-parent 線上）
#   merged    = 内容が base に取り込み済み（ancestor / squash / cherry-pick）
#   other     = base に未取り込みの独自コミットあり
classify_branch() {
  local base="$1" branch="$2" head mb squash cherry
  head=$(git rev-parse "$branch" 2>/dev/null) || { echo other; return; }
  if git rev-list --first-parent "$base" 2>/dev/null | grep -qx "$head"; then echo untouched; return; fi
  if git merge-base --is-ancestor "$branch" "$base" 2>/dev/null; then echo merged; return; fi
  mb=$(git merge-base "$base" "$branch" 2>/dev/null) || true
  if [ -n "$mb" ]; then
    squash=$(git commit-tree "$branch^{tree}" -p "$mb" -m _ 2>/dev/null) || true
    cherry=$(git cherry "$base" "$squash" 2>/dev/null) || true
    [ -n "$cherry" ] && [ "$(printf '%s\n' "$cherry" | grep -c '^+')" -eq 0 ] && { echo merged; return; }
  fi
  [ -z "$(git log --cherry-pick --right-only --no-merges --oneline "$base...$branch" 2>/dev/null)" ] && { echo merged; return; }
  echo other
}

base=$(resolve_base)
main_wt=$(git worktree list --porcelain | grep --color=never -m1 '^worktree ' | sed 's/^worktree //')
current_wt=$(canonical_path "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")

# 1) worktree: merge済 かつ clean だけ削除（untouched / 未マージ / dirty は残す）
while read -r wt; do
  [ "$wt" = "$main_wt" ] && continue
  [ "$(canonical_path "$wt")" = "$current_wt" ] && continue
  branch=$(git -C "$wt" symbolic-ref --short -q HEAD) || continue   # detached は残す
  [ "$branch" = "$base" ] && continue
  is_locked_worktree "$wt" && continue
  has_running_claude_session "$wt" && continue
  has_uncommitted_changes "$wt" && continue
  [ "$(classify_branch "$base" "$branch")" = merged ] || continue   # untouched/other は残す
  git worktree remove "$wt" && echo "removed worktree: $wt" || echo "skip worktree: $wt" >&2
done < <(git worktree list --porcelain | grep --color=never '^worktree ' | sed 's/^worktree //')
git worktree prune

# 2) branch: base にある（merged/untouched）だけ削除。worktree を取り直して checkout 判定
current_head=$(git symbolic-ref --short -q HEAD || true)
while read -r branch; do
  [ -z "$branch" ] && continue
  [ "$branch" = "$base" ] && continue
  [ "$branch" = "$current_head" ] && continue
  git worktree list --porcelain | grep -qx "branch refs/heads/$branch" && continue
  [ "$(classify_branch "$base" "$branch")" != other ] || continue
  git branch -D "$branch" >/dev/null 2>&1 && echo "removed branch: $branch" || echo "skip branch: $branch" >&2
done < <(git branch --format='%(refname:short)')
