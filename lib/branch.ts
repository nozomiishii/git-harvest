import type { Classification, CleanupDecisionResult, CleanupResult, Flags, Stage } from "./types";
import { git, gitText } from "./git";
import { classifyBranch } from "./merge-detect";
import { atOrSafer } from "./types";

export type BranchInfo = {
  classification: Classification;
  invariantReason: string | undefined;
  name: string;
};

type Opts = { cwd?: string };

export async function cleanupBranches(
  base: string,
  flags: Flags,
  survivingPaths: string[],
  opts: Opts = {},
): Promise<CleanupResult> {
  const branchesOut = await gitText(["branch", "--format=%(refname:short)"], opts);
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  const porcelain = await gitText(["worktree", "list", "--porcelain"], opts);
  const checkedOut = checkedOutBranches(porcelain, survivingPaths);
  const invariantOf = (name: string): string | undefined => {
    if (name === currentHead) {
      return "current HEAD";
    }

    if (checkedOut.has(name)) {
      return "checked out";
    }

    return undefined;
  };
  const results: CleanupResult["results"] = [];

  for (const name of branchesOut
    .split("\n")
    .map((b) => b.trim())
    // detached HEAD では "(HEAD detached at ...)" 行が混ざるので除外
    .filter((b) => b && !b.startsWith("("))) {
    if (name === base) {
      continue;
    }

    try {
      const invariantReason = invariantOf(name);
      const classification = await classifyBranch({ base, branch: name }, opts);
      const decision = decideBranch({ classification, invariantReason, name }, flags);

      if (!decision.remove) {
        results.push({ action: "kept", name, reason: decision.reason });
        continue;
      }

      if (flags.dryRun) {
        results.push({ action: "would-remove", name });
        continue;
      }
      const { code, stderr } = await git(["branch", "-D", name], opts);

      // "not found" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
      if (code === 0 || stderr.includes("not found")) {
        results.push({ action: "removed", name });
      } else {
        results.push({ action: "failed", error: `exit ${String(code)}: ${stderr.trim()}`, name });
      }
    } catch (error) {
      // 1 件の throw で全体を止めない（fail-soft）
      results.push({ action: "failed", error: String(error), name });
    }
  }

  if (!flags.dryRun) {
    // リモートで削除済みの追跡ブランチ (origin/*) を整理。offline 等の失敗は無視（git は throw しない）
    await git(["fetch", "--prune"], opts);
  }
  const failures = results.filter((r) => r.action === "failed").length;

  return { failures, results, survivingPaths };
}

export function decideBranch(info: BranchInfo, flags: Flags): CleanupDecisionResult {
  if (info.invariantReason) {
    return { reason: info.invariantReason, remove: false };
  }
  const stage = branchStage(info.classification);

  return atOrSafer(stage, flags.thresholds.branch)
    ? { remove: true }
    : { reason: stage, remove: false };
}

function branchStage(c: Classification): Stage {
  return c === "other" ? "committed" : "merged";
}

// porcelain の各エントリから、生存 worktree に checkout 中の branch 名を集める
function checkedOutBranches(porcelain: string, survivingPaths: string[]): Set<string> {
  const checkedOut = new Set<string>();

  for (const block of porcelain.split("\n\n")) {
    const lines = block.split("\n");
    const wtPath = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    const branch = lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length);

    if (wtPath !== undefined && branch !== undefined && survivingPaths.includes(wtPath)) {
      checkedOut.add(branch);
    }
  }

  return checkedOut;
}
