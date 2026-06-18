import type { WtRecord } from "./list";
import { hasRunningAgentSession } from "../agent/session";
import { isInside } from "../path";

// 守る理由ごとの判定関数。どれか 1 つでも true なら、その worktree は
// どんなフラグを指定されても消さない。
// main worktree は listWorktrees が先頭で切り離すのでここには来ない

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
  return hasRunningAgentSession(worktree.path);
}
