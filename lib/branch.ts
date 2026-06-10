import type {
  ActionResult,
  Classification,
  CleanupDecisionResult,
  CleanupResult,
  Flags,
  Stage,
} from "./types";
import { git, gitText, NETWORK_TIMEOUT_MS } from "./git";
import { classifyBranch } from "./merge-detect";
import { atOrSafer } from "./types";

export type BranchInfo = {
  classification: Classification;
  invariantReason: string | undefined;
};

type HarvestContext = {
  base: string;
  currentHead: string;
  flags: Flags;
  opts: Opts;
  survivingBranches: Set<string>;
};

type Opts = { cwd?: string };

export async function cleanupBranches(
  base: string,
  flags: Flags,
  survivingBranches: Set<string>,
  opts: Opts = {},
): Promise<CleanupResult> {
  // for-each-ref は refs/heads 配下の ref だけを出す: detached のプレースホルダ行が混ざらず、
  // 同名 tag があっても refname:short のような曖昧性解消名（heads/x）にならない
  const branchesOut = await gitText(
    ["for-each-ref", "refs/heads", "--format=%(refname:lstrip=2)"],
    opts,
  );
  // detached HEAD では symbolic-ref が失敗するので ""（どの branch 名とも一致しない）
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  const context: HarvestContext = { base, currentHead, flags, opts, survivingBranches };
  const results: ActionResult[] = [];

  // base 自身は掃除対象外（results にも出さない）。並列化しない: 直列 await で順序と index.lock を守る
  for (const name of listLocalBranches(branchesOut).filter((branchName) => branchName !== base)) {
    results.push(await harvestOne(name, context));
  }

  if (!flags.dryRun) {
    // リモートで削除済みの追跡ブランチ (origin/*) を整理。fetch と違いオブジェクト転送をしない。
    // offline 等の失敗は無視（git は throw しない）し、hook をブロックしないよう上限時間で打ち切る
    await git(["remote", "prune", "origin"], { ...opts, timeoutMs: NETWORK_TIMEOUT_MS });
  }
  const failures = results.filter((r) => r.action === "failed").length;

  return { failures, results };
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

// 1 branch → 1 結果。fail-soft の catch を内側に持ち、呼び出し側へは throw しない契約
async function harvestOne(name: string, context: HarvestContext): Promise<ActionResult> {
  try {
    const invariantReason = invariantOf(name, context);
    const classification = await classifyBranch({ base: context.base, branch: name }, context.opts);
    const decision = decideBranch({ classification, invariantReason }, context.flags);

    if (!decision.remove) {
      return { action: "kept", name, reason: decision.reason };
    }

    if (context.flags.dryRun) {
      return { action: "would-remove", name };
    }

    return await removeBranch(name, context.opts);
  } catch (error) {
    // 1 件の throw（壊れた ref 等）で全体を止めない
    return { action: "failed", error: String(error), name };
  }
}

function invariantOf(name: string, context: HarvestContext): string | undefined {
  if (name === context.currentHead) {
    return "current HEAD";
  }

  if (context.survivingBranches.has(name)) {
    return "checked out";
  }

  return undefined;
}

// 空リポジトリでは出力が空文字になり split が [""] を返すため除外する
function listLocalBranches(branchesOut: string): string[] {
  return branchesOut.split("\n").filter((name) => name !== "");
}

// 競合 rescue とエラー整形だけを持つ実行関数
async function removeBranch(name: string, opts: Opts): Promise<ActionResult> {
  const { code, stderr } = await git(["branch", "-D", name], opts);

  // "not found" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("not found")) {
    return { action: "removed", name };
  }

  return { action: "failed", error: `exit ${String(code)}: ${stderr.trim()}`, name };
}
