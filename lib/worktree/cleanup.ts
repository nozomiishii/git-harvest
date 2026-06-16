import { existsSync } from "node:fs";
import { scopeOfPath } from "../agent/scope";
import { git } from "../git/exec";
import { isMerged, isUntouched } from "../merged/index";
import { canonical } from "../path";
import type { Flags, WorktreeActionResult, WorktreeCleanupResult } from "../types";
import { isCwd, isLocked, isOnBaseBranch, isSessionRunning } from "./guards";
import { listWorktrees } from "./list";
import {
  removeCommitted,
  removeDetached,
  removeFilesChanged,
  removeMerged,
  removeUntouched,
} from "./remove";
import { hasUncommittedChanges } from "./uncommitted";

type Opts = { cwd?: string };

// worktree = 同じリポジトリの履歴を共有する、もう 1 つの作業ディレクトリ（git worktree add で作る）。
// 一覧を取り、1 つずつ「守る → 状態を判定 → 対応する削除関数」と上から下りる
export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  opts: Opts = {},
): Promise<WorktreeCleanupResult> {
  const all = await listWorktrees(opts);
  // porcelain の先頭は main worktree。常に生存し、その checkout branch は mainBranch として branch 掃除へ渡す
  const [mainWorktree, ...linkedWorktrees] = all;
  const current = canonical(opts.cwd ?? process.cwd());
  const results: WorktreeActionResult[] = [];
  // files-changed は committed より危険な段なので、その scope は committed にも降りる（ladder cascade）
  const committedScopes = new Set([...flags.committed, ...flags.filesChanged]);

  // 並列化しない: git の index.lock 競合と results の順序を守るため直列 await
  for (const worktree of linkedWorktrees) {
    // ディレクトリごと消された prunable worktree は prune に任せ、結果に含めない
    if (!existsSync(worktree.path)) {
      continue;
    }

    try {
      // 守る理由を上から1つずつ確認。当たればその理由で残す
      if (isCwd(worktree, current)) {
        results.push({ action: "kept", branch: worktree.branch, message: "current", path: worktree.path });
        continue;
      }

      if (isOnBaseBranch(worktree, base)) {
        results.push({ action: "kept", branch: worktree.branch, message: "base branch", path: worktree.path });
        continue;
      }

      if (isLocked(worktree)) {
        results.push({ action: "kept", branch: worktree.branch, message: "locked", path: worktree.path });
        continue;
      }

      if (isSessionRunning(worktree)) {
        results.push({ action: "kept", branch: worktree.branch, message: "session running", path: worktree.path });
        continue;
      }

      // detached = branch を持たない worktree。off-ladder なので --detached でだけ消す
      if (worktree.branch === undefined) {
        results.push(await removeDetached(worktree, flags.detached, flags.dryRun, opts));
        continue;
      }
      // 状態を上から1つずつ判定し、対応する削除関数を即実行する。
      // committed / files-changed は、この worktree の scope が対象に入っているかを渡す
      const scope = scopeOfPath(worktree.path);
      const refs = { base, branch: worktree.branch };

      // 未コミットの変更が最優先（消すと復元できない）
      if (await hasUncommittedChanges(worktree.path)) {
        results.push(await removeFilesChanged(worktree, flags.filesChanged.includes(scope), flags.dryRun, opts));
        continue;
      }

      // 独自コミット無し（off-ladder）。--untouched でだけ消す
      if (await isUntouched(refs, opts)) {
        results.push(await removeUntouched(worktree, flags.untouched, flags.dryRun, opts));
        continue;
      }

      if (await isMerged(refs, opts)) {
        results.push(await removeMerged(worktree, flags.dryRun, opts));
        continue;
      }

      // どれでもない = 未マージの独自コミットあり（committed）
      results.push(await removeCommitted(worktree, committedScopes.has(scope), flags.dryRun, opts));
    } catch (error) {
      // 1 件の throw（壊れた ref で rev-parse 失敗 等）で全体を止めない
      results.push({ action: "failed", branch: worktree.branch, message: String(error), path: worktree.path });
    }
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const failures = results.filter((r) => r.action === "failed").length;

  // main worktree は常に生存。その checkout branch を branch 掃除へ引き継ぐ（使用中の branch を誤って消さない）
  return { failures, mainBranch: mainWorktree?.branch, results };
}
