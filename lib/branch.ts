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
  const checkedOut = new Set<string>();
  const porcelain = await gitText(["worktree", "list", "--porcelain"], opts);
  let curPath = "";

  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      curPath = line.slice(9);
    } else if (line.startsWith("branch ") && survivingPaths.includes(curPath)) {
      checkedOut.add(line.slice("branch refs/heads/".length));
    }
  }
  const results: CleanupResult["results"] = [];
  let failures = 0;

  for (const name of branchesOut
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean)) {
    if (name === base) {
      continue;
    }

    try {
      let invariantReason: string | undefined;

      if (name === currentHead) {
        invariantReason = "current HEAD";
      } else if (checkedOut.has(name)) {
        invariantReason = "checked out";
      }
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
      const { code, stdout } = await git(["branch", "-D", name], opts);

      if (code === 0 || stdout.includes("not found")) {
        results.push({ action: "removed", name });
      } else {
        results.push({ action: "failed", error: `exit ${String(code)}`, name });
        failures += 1;
      }
    } catch (error) {
      // 1 件の throw で全体を止めない（fail-soft）
      results.push({ action: "failed", error: String(error), name });
      failures += 1;
    }
  }

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
