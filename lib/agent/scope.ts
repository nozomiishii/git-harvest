import { homedir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { isInside, realpath } from "../path";

/**
 * パスが Claude Code の worktree ディレクトリを含むか調べる。
 *
 * @param candidate - 判定するパス。
 *
 * @returns 該当する場合は true。
 */
export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

/**
 * パス表記または CODEX_HOME 配下への包含で Codex の worktree か調べる。
 *
 * @param candidate - 判定するパス。
 *
 * @returns 該当する場合は true。
 */
export function isCodexWorktree(candidate: string): boolean {
  return /\/\.codex\/worktrees\/.+/.test(candidate) || isCodexHomeWorktree(candidate);
}

/**
 * worktree のパスから管理元の scope を決める。
 *
 * @param candidate - 判定するパス。
 *
 * @returns パスに対応する scope。
 */
export function scopeOfPath(candidate: string): "claude-worktree" | "codex-worktree" | "worktree" {
  if (isClaudeWorktree(candidate)) {
    return "claude-worktree";
  }

  return isCodexWorktree(candidate) ? "codex-worktree" : "worktree";
}

/**
 * CODEX_HOME を基に Codex の worktree ディレクトリを求める。
 *
 * @returns Codex の worktrees ディレクトリ。
 */
function codexWorktreesDir(): string {
  return path.join(env.CODEX_HOME ?? path.join(homedir(), ".codex"), "worktrees");
}

/**
 * パスを正規化して CODEX_HOME の worktrees 配下か調べる。
 *
 * @param candidate - 判定するパス。
 *
 * @returns 該当する場合は true。
 */
function isCodexHomeWorktree(candidate: string): boolean {
  const child = realpath(candidate);
  const parent = realpath(codexWorktreesDir());

  return child !== parent && isInside({ child, parent });
}
