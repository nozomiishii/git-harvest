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
  // symbolic-ref --short HEAD = 今 checkout 中のブランチ名。
  // detached HEAD（ブランチに居ない状態）では失敗するので ""（どの branch 名とも一致しない）
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  // worktree 掃除を生き延びた worktree が checkout 中の branch は、消すと壊れるので保護する
  const checkedOut = checkedOutBranches(worktrees);
  const results: BranchActionResult[] = [];

  // base 自身は掃除対象外（results にも出さない）。並列化しない: 直列 await で順序と index.lock を守る
  for (const name of branches.filter((branchName) => branchName !== base)) {
    try {
      // 守る理由を上から1つずつ確認。当たればその理由で残す
      if (isCurrentHead(name, currentHead)) {
        results.push({ action: "kept", message: "current HEAD", name });
        continue;
      }

      if (checkedOut.has(name)) {
        results.push({ action: "kept", message: "checked out", name });
        continue;
      }
      // branch は files-changed 段が無い。untouched / merged は in-base 残骸として常に消す。
      // それ以外（未取り込みの独自コミット）は committed で、--committed=branch のときだけ消す
      const refs = { base, branch: name };

      if ((await isUntouched(refs, opts)) || (await isMerged(refs, opts))) {
        results.push(await removeMergedBranch(name, flags.dryRun, opts));
        continue;
      }

      results.push(
        await removeCommittedBranch(name, flags.committed.includes("branch"), flags.dryRun, opts),
      );
    } catch (error) {
      // 1 件の throw（壊れた ref 等）で全体を止めない
      results.push({ action: "failed", message: String(error), name });
    }
  }

  if (!flags.dryRun) {
    // リモートで削除済みの追跡ブランチ (origin/*) を整理。fetch と違いオブジェクト転送をしない。
    // offline 等の失敗は無視（git は throw しない）し、hook をブロックしないよう上限時間で打ち切る
    await git(["remote", "prune", "origin"], { ...opts, timeoutMs: NETWORK_TIMEOUT_MS });
  }
  const failures = results.filter((r) => r.action === "failed").length;

  return { failures, results };
}
