import { git, gitText, NETWORK_TIMEOUT_MS } from "../git/exec";
import { isMerged, isUntouched } from "../merged/index";
import type { BranchActionResult, BranchCleanupResult, Flags, WorktreeCleanupResult } from "../types";
import { checkedOutBranches, isCurrentHead } from "./guards";
import { listLocalBranches } from "./list";
import { removeCommittedBranch, removeMergedBranch } from "./remove";

type Opts = { cwd?: string };

// ローカルブランチの一覧を取り、1 つずつ「守る → 状態を判定 → 削除」する
export async function cleanupBranches(
  base: string,
  flags: Flags,
  worktrees: WorktreeCleanupResult,
  opts: Opts = {},
): Promise<BranchCleanupResult> {
  const branches = await listLocalBranches(opts);
  // いま checkout している branch 名。detached HEAD（どの branch にも乗っていない状態）では
  // コマンドが失敗するので、その場合は ""（どの branch 名とも一致しない）にする
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  // worktree 掃除のあとも残っている worktree が checkout 中の branch は、消すと
  // その worktree が壊れるので保護する
  const checkedOut = checkedOutBranches(worktrees);
  const results: BranchActionResult[] = [];

  // base 自身は掃除対象から外す。
  // worktree 掃除と同じ理由で直列。index.lock を取り合わない / 結果の順序を保つため
  for (const name of branches.filter((branchName) => branchName !== base)) {
    try {
      // 守る理由を上から順に確認し、当たればその理由で残す
      if (isCurrentHead(name, currentHead)) {
        results.push({ action: "kept", message: "current HEAD", name });
        continue;
      }

      if (checkedOut.has(name)) {
        results.push({ action: "kept", message: "checked out", name });
        continue;
      }
      // branch には files-changed 段が無い（worktree と違い、未コミット変更は持たない）。
      // untouched と merged はどちらも「すでに base に取り込まれた残骸」なので常に消す。
      // それ以外（base に未取り込みの独自コミットあり）は committed として扱い、
      // --committed=branch が指定されているときだけ消す
      const refs = { base, branch: name };

      if ((await isUntouched(refs, opts)) || (await isMerged(refs, opts))) {
        results.push(await removeMergedBranch(name, flags.dryRun, opts));
        continue;
      }

      results.push(
        await removeCommittedBranch(
          name,
          { dryRun: flags.dryRun, enabled: flags.committed.includes("branch") },
          opts,
        ),
      );
    } catch (error) {
      // 1 件の失敗で全体を止めない（worktree 掃除と同じ方針）
      results.push({ action: "failed", message: String(error), name });
    }
  }

  if (!flags.dryRun) {
    // リモートで既に削除されている追跡ブランチ (origin/*) を片付ける。
    // fetch と違ってオブジェクト転送はしないので軽い。
    // オフライン等で失敗しても git は throw しないので無視できる。
    // post-merge hook から呼ばれることがあるので、上限時間で必ず打ち切る
    await git(["remote", "prune", "origin"], { ...opts, timeoutMs: NETWORK_TIMEOUT_MS });
  }
  const failures = results.filter((r) => r.action === "failed").length;

  return { failures, results };
}
