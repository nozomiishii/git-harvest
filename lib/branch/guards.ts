import type { WorktreeCleanupResult } from "../types";

/**
 * 残る worktree が checkout 中のブランチ名を集める。
 * main と kept / failed の linked worktree を含め、removed / would-remove は除く。
 *
 * @param worktrees - worktree 整理で残ったブランチを含む結果。
 *
 * @returns 保護対象のブランチ名の集合。
 */
export function checkedOutBranches(worktrees: WorktreeCleanupResult): Set<string> {
  const branches = new Set<string>(
    worktrees.mainBranch === undefined ? [] : [worktrees.mainBranch],
  );

  for (const result of worktrees.results) {
    if ((result.action === "kept" || result.action === "failed") && result.branch !== undefined) {
      branches.add(result.branch);
    }
  }

  return branches;
}

/**
 * ブランチが現在の HEAD か調べる。
 *
 * @param name - 対象のブランチ名。
 *
 * @param currentHead - 現在 checkout 中のブランチ名。
 *
 * @returns 現在の HEAD なら true。
 */
export function isCurrentHead(name: string, currentHead: string): boolean {
  return name === currentHead;
}
