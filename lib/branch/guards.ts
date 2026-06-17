import type { WorktreeCleanupResult } from "../types";

// 生存 worktree（常に残る main + kept/failed の linked）が checkout 中の branch を集める。
// removed / would-remove は消える（予定）なので保護しない
export function checkedOutBranches(worktrees: WorktreeCleanupResult): Set<string> {
  const branches = new Set<string>();

  if (worktrees.mainBranch !== undefined) {
    branches.add(worktrees.mainBranch);
  }

  for (const result of worktrees.results) {
    if ((result.action === "kept" || result.action === "failed") && result.branch !== undefined) {
      branches.add(result.branch);
    }
  }

  return branches;
}

export function isCurrentHead(name: string, currentHead: string): boolean {
  return name === currentHead;
}
