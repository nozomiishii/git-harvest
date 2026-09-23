import type { WtRecord } from "./list";
import { hasRunningAgentSession } from "../agent/session";
import { isInside } from "../path";

// 守る理由ごとの判定関数。どれか 1 つでも true なら、その worktree は
// どんなフラグを指定されても消さない。
// main worktree は listWorktrees が先頭で切り離すのでここには来ない

/**
 * 現在の作業ディレクトリが worktree 内か調べる。
 * worktree の直下だけでなく、そのサブディレクトリも含む。
 *
 * @param worktree - 対象の worktree。
 *
 * @param current - 現在の作業ディレクトリの実際のパス。
 *
 * @returns worktree 内なら true。
 */
export function isCwd(worktree: WtRecord, current: string): boolean {
  return isInside({ child: current, parent: worktree.realpath });
}

/**
 * worktree がロックされているか調べる。
 *
 * @param worktree - 対象の worktree。
 *
 * @returns ロック中なら true。
 */
export function isLocked(worktree: WtRecord): boolean {
  return worktree.locked;
}

/**
 * worktree が基準ブランチを checkout 中か調べる。
 *
 * @param worktree - 対象の worktree。
 *
 * @param base - 整理の基準になるブランチ名。
 *
 * @returns 基準ブランチ上なら true。
 */
export function isOnBaseBranch(worktree: WtRecord, base: string): boolean {
  return worktree.branch === base;
}

/**
 * worktree に保護対象の Claude Code session または Codex user thread があるか調べる。
 * Codex user thread は未アーカイブなら待機中も対象になる。
 *
 * @param worktree - 対象の worktree。
 *
 * @returns 保護対象の session または thread があれば true。
 */
export function isSessionRunning(worktree: WtRecord): boolean {
  return hasRunningAgentSession(worktree.path);
}
