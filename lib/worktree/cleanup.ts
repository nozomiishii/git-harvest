import { existsSync } from "node:fs";
import { scopeOfPath } from "../agent/scope";
import { git } from "../git/exec";
import { isMerged, isUntouched } from "../merged/index";
import { realpath } from "../path";
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
  // 一覧の先頭は main worktree（git worktree list の仕様）。
  // main は常に守るため切り離し、checkout 中の branch だけ branch 掃除に渡す
  const [mainWorktree, ...linkedWorktrees] = all;
  const current = realpath(opts.cwd ?? process.cwd());
  const results: WorktreeActionResult[] = [];
  // files-changed の scope は committed にも自動で含める。
  // files-changed は committed より危険な段（消すと復元できない）なので、
  // それを消す指定をしているなら、より安全な committed も同じ scope で消して良い
  const committedScopes = new Set([...flags.committed, ...flags.filesChanged]);

  // 直列に処理する。並列化すると git の .git/index.lock を取り合って失敗し得るし、
  // 結果の順序も保てなくなる
  for (const worktree of linkedWorktrees) {
    // ディレクトリ自体が削除されている worktree は git worktree prune が片付けるので、
    // 結果には載せない
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
        results.push(
          await removeDetached(worktree, { dryRun: flags.dryRun, enabled: flags.detached }, opts),
        );
        continue;
      }
      // 状態を上から1つずつ判定し、対応する削除関数を即実行する。
      // committed / files-changed は、この worktree の scope が対象に入っているかを渡す
      const scope = scopeOfPath(worktree.path);
      const refs = { base, branch: worktree.branch };

      // 未コミットの変更が最優先（消すと復元できない）
      if (await hasUncommittedChanges(worktree.path)) {
        results.push(
          await removeFilesChanged(
            worktree,
            { dryRun: flags.dryRun, enabled: flags.filesChanged.includes(scope) },
            opts,
          ),
        );
        continue;
      }

      // 独自コミット無し（off-ladder）。--untouched でだけ消す
      if (await isUntouched(refs, opts)) {
        results.push(
          await removeUntouched(worktree, { dryRun: flags.dryRun, enabled: flags.untouched }, opts),
        );
        continue;
      }

      if (await isMerged(refs, opts)) {
        results.push(await removeMerged(worktree, flags.dryRun, opts));
        continue;
      }

      // どれでもない = 未マージの独自コミットあり（committed）
      results.push(
        await removeCommitted(
          worktree,
          { dryRun: flags.dryRun, enabled: committedScopes.has(scope) },
          opts,
        ),
      );
    } catch (error) {
      // 1 件の失敗で全体を止めない。たとえば壊れた ref に当たって git が throw しても、
      // その worktree を failed として記録し、残りの掃除は続ける
      results.push({ action: "failed", branch: worktree.branch, message: String(error), path: worktree.path });
    }
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const failures = results.filter((r) => r.action === "failed").length;

  // main worktree が checkout 中の branch も branch 掃除で守る必要があるので、
  // その branch 名を mainBranch として引き継ぐ
  return { failures, mainBranch: mainWorktree?.branch, results };
}
