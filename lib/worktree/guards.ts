import { hasRunningClaudeSession } from "../agent/session";
import { isInside } from "../path";
import type { WtRecord } from "./list";

// 守る理由ごとの述語。どれか true ならその worktree はどのフラグでも消さない。
// main は listWorktrees が先頭分離するためここに来ず、判定不要。

// cwd が worktree 直下でもサブディレクトリでも current 扱い
export function isCwd(worktree: WtRecord, current: string): boolean {
  return isInside({ child: current, parent: worktree.realpath });
}

export function isLocked(worktree: WtRecord): boolean {
  return worktree.locked;
}

export function isOnBaseBranch(worktree: WtRecord, base: string): boolean {
  return worktree.branch === base;
}

export function isSessionRunning(worktree: WtRecord): boolean {
  return hasRunningClaudeSession(worktree.path);
}
