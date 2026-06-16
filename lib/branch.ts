import type {
  BranchActionResult,
  BranchCleanupResult,
  Flags,
  WorktreeCleanupResult,
} from "./types";
import { git, gitText, NETWORK_TIMEOUT_MS } from "./git";
import { isMerged, isUntouched } from "./merged";

type Opts = { cwd?: string };

// ローカルブランチの一覧を取り、1 つずつ「守る → 状態を判定 → 削除」する
export async function cleanupBranches(
  base: string,
  flags: Flags,
  worktrees: WorktreeCleanupResult,
  opts: Opts = {},
): Promise<BranchCleanupResult> {
  // refs/heads = ローカルブランチの置き場。for-each-ref はその一覧をスクリプト向けに出し、
  // lstrip=2 で "refs/heads/foo" を "foo" にする。refs/heads 配下だけを出すので
  // detached のプレースホルダ行が混ざらず、同名 tag があっても曖昧性解消名（heads/x）にならない
  const branchesOut = await gitText(
    ["for-each-ref", "refs/heads", "--format=%(refname:lstrip=2)"],
    opts,
  );
  // symbolic-ref --short HEAD = 今 checkout 中のブランチ名。
  // detached HEAD（ブランチに居ない状態）では失敗するので ""（どの branch 名とも一致しない）
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  // worktree 掃除を生き延びた worktree が checkout 中の branch は、消すと壊れるので保護する
  const checkedOut = checkedOutBranches(worktrees);
  const results: BranchActionResult[] = [];

  // base 自身は掃除対象外（results にも出さない）。並列化しない: 直列 await で順序と index.lock を守る
  for (const name of listLocalBranches(branchesOut).filter((branchName) => branchName !== base)) {
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

// 生存 worktree（常に残る main + kept/failed の linked）が checkout 中の branch を集める。
// removed / would-remove は消える（予定）なので保護しない
function checkedOutBranches(worktrees: WorktreeCleanupResult): Set<string> {
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

function isCurrentHead(name: string, currentHead: string): boolean {
  return name === currentHead;
}

// 空リポジトリでは出力が空文字になり split が [""] を返すため除外する
function listLocalBranches(branchesOut: string): string[] {
  return branchesOut.split("\n").filter((name) => name !== "");
}

// 競合 rescue とエラー整形だけを持つ実行関数。
// branch -D は「base に取り込み済みか」を git 側で確認しない強制削除（-d は未マージを拒否する）。
// 取り込み済み確認は上の isUntouched / isMerged 判定で済んでいるため -D で良い
async function removeBranch(name: string, opts: Opts): Promise<BranchActionResult> {
  const { code, stderr } = await git(["branch", "-D", name], opts);

  // "not found" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("not found")) {
    return { action: "removed", name };
  }

  return { action: "failed", message: `exit ${String(code)}: ${stderr.trim()}`, name };
}

// committed の branch は committed の対象に branch が入っていれば消す、なければ理由付きで残す
async function removeCommittedBranch(
  name: string,
  isTarget: boolean,
  dryRun: boolean,
  opts: Opts,
): Promise<BranchActionResult> {
  if (!isTarget) {
    return { action: "kept", message: "committed", name };
  }

  if (dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

// merged の branch は base 取り込み済みの残骸なので常に消す
async function removeMergedBranch(
  name: string,
  dryRun: boolean,
  opts: Opts,
): Promise<BranchActionResult> {
  if (dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}
