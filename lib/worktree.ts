import { realpathSync } from "node:fs";
import nodePath from "node:path";
import type { ActionResult, CleanupDecisionResult, CleanupResult, Flags, Stage } from "./types";
import { hasRunningClaudeSession, scopeOfPath } from "./agent";
import { git, gitExitOk, gitText } from "./git";
import { classifyBranch } from "./merge-detect";
import { atOrSafer } from "./types";

export type WorktreeInfo = {
  hasBranch: boolean;
  hasUncommittedChanges: boolean;
  invariantReason: string | undefined;
  isMerged: boolean;
  isUntouched: boolean;
  path: string;
};

export type WtRecord = { branch: string | undefined; canon: string; locked: boolean; path: string };

type HarvestContext = {
  base: string;
  current: string;
  flags: Flags;
  mainPath: string;
  opts: Opts;
};

type Opts = { cwd?: string };

// harvestOne の結果に canon を添えて、survivingPaths を raw path でなく realpath 済みで導出できるようにする
type WorktreeOutcome = { canon: string; result: ActionResult };

export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  opts: Opts = {},
): Promise<CleanupResult> {
  const { main, others } = await listWorktrees(opts);
  const mainPath = main ? main.canon : "";
  const current = canonical(opts.cwd ?? process.cwd());
  const context: HarvestContext = { base, current, flags, mainPath, opts };
  const outcomes: WorktreeOutcome[] = [];

  // 並列化しない: git の index.lock 競合と results の順序を守るため直列 await
  for (const rec of others) {
    outcomes.push({ canon: rec.canon, result: await harvestOne(rec, context) });
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const results = outcomes.map((outcome) => outcome.result);
  const failures = results.filter((r) => r.action === "failed").length;
  // 生存 = main + kept + failed（would-remove / removed は消えるもの扱い）
  const survivingPaths = [
    ...(main ? [main.canon] : []),
    ...outcomes.filter((o) => o.result.action === "kept" || o.result.action === "failed").map((o) => o.canon),
  ];

  return { failures, results, survivingPaths };
}

// yolo は flags に展開済みなので判定に yolo 分岐は無い
export function decideWorktree(info: WorktreeInfo, flags: Flags): CleanupDecisionResult {
  if (info.invariantReason) {
    return { reason: info.invariantReason, remove: false };
  }

  if (!info.hasBranch) {
    return flags.detached ? { remove: true } : { reason: "detached", remove: false };
  }

  if (info.isUntouched) {
    return flags.untouched ? { remove: true } : { reason: "untouched", remove: false };
  }
  const stage = worktreeStage(info);
  const threshold = flags.thresholds[scopeOfPath(info.path)];

  return atOrSafer(stage, threshold) ? { remove: true } : { reason: stage, remove: false };
}

export async function listWorktrees(
  opts: Opts = {},
): Promise<{ main: undefined | WtRecord; others: WtRecord[] }> {
  const out = await gitText(["worktree", "list", "--porcelain"], opts);
  // porcelain はエントリごとに空行区切り。各エントリは worktree 行 + 任意の branch / locked 行
  const records = out
    .split("\n\n")
    .map((block) => parseWorktreeBlock(block))
    .filter((rec) => rec.path !== "");
  // git の保証: porcelain は先頭エントリが main worktree
  const [main, ...others] = records;

  return { main, others };
}

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// 1 worktree → 1 結果。fail-soft の catch を内側に持ち、呼び出し側へは throw しない契約
async function harvestOne(rec: WtRecord, context: HarvestContext): Promise<ActionResult> {
  try {
    const invariantReason = invariantOf(rec, context);
    // invariant があっても無条件に収集する: 壊れた ref はここで throw → failed になり exit code を保つ
    const hasUncommittedChanges = await hasUncommitted(rec.path);
    const classification =
      rec.branch === undefined
        ? undefined
        : await classifyBranch({ base: context.base, branch: rec.branch }, context.opts);
    const decision = decideWorktree(
      {
        hasBranch: rec.branch !== undefined,
        hasUncommittedChanges,
        invariantReason,
        isMerged: classification === "merged",
        isUntouched: classification === "untouched" && !hasUncommittedChanges,
        path: rec.path,
      },
      context.flags,
    );

    if (!decision.remove) {
      return { action: "kept", name: rec.path, reason: decision.reason };
    }

    if (context.flags.dryRun) {
      return { action: "would-remove", name: rec.path };
    }

    return await removeWorktree(rec.path, context.opts);
  } catch (error) {
    // 1 件の throw（壊れた ref で classifyBranch が rev-parse 失敗 等）で全体を止めない
    return { action: "failed", error: String(error), name: rec.path };
  }
}

async function hasUncommitted(wt: string): Promise<boolean> {
  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "HEAD"]))) {
    return true;
  }

  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "--cached"]))) {
    return true;
  }
  const others = await git(["-C", wt, "ls-files", "--others", "--exclude-standard"]);

  return others.stdout.trim().length > 0;
}

function invariantOf(rec: WtRecord, context: HarvestContext): string | undefined {
  // { main, others } 分割で構造上ここには来ないはずだが、誤削除防止の防御層として残す
  if (rec.canon === context.mainPath) {
    return "main";
  }

  // cwd が worktree 直下でもサブディレクトリでも current 扱い（sep 付き比較で /wt-foo の前方一致誤判定を防ぐ）
  if ((context.current + nodePath.sep).startsWith(rec.canon + nodePath.sep)) {
    return "current";
  }

  if (rec.branch === context.base) {
    return "base branch";
  }

  if (rec.locked) {
    return "locked";
  }

  if (hasRunningClaudeSession(rec.path)) {
    return "session running";
  }

  return undefined;
}

function parseWorktreeBlock(block: string): WtRecord {
  const lines = block.split("\n");
  const path = lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? "";

  return {
    branch: lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length),
    // canon はパース時に 1 回だけ付与（macOS の /private symlink 対策。以後の path 比較は canon で行う）
    canon: canonical(path),
    locked: lines.some((l) => l.startsWith("locked")),
    path,
  };
}

// 競合 rescue とエラー整形だけを持つ実行関数
async function removeWorktree(path: string, opts: Opts): Promise<ActionResult> {
  const { code, stderr } = await git(["worktree", "remove", "--force", path], opts);

  // "is not a working tree" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("is not a working tree")) {
    return { action: "removed", name: path };
  }

  return { action: "failed", error: `exit ${String(code)}: ${stderr.trim()}`, name: path };
}

function worktreeStage(info: WorktreeInfo): Stage {
  if (info.hasUncommittedChanges) {
    return "files-changed";
  }

  if (info.isMerged) {
    return "merged";
  }

  return "committed";
}
