import { existsSync } from "node:fs";
import type {
  ActionResult,
  CleanupDecisionResult,
  Flags,
  Stage,
  WorktreeCleanupResult,
} from "./types";
import { hasRunningClaudeSession, scopeOfPath } from "./agent";
import { git, gitExitOk, gitText } from "./git";
import { classifyBranch } from "./merged";
import { canonical, isInside } from "./path";
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

// harvestOne の結果に元の record を添えて、生存 worktree の branch 名を後から導出できるようにする
type WorktreeOutcome = { rec: WtRecord; result: ActionResult };

// worktree = 同じリポジトリの履歴を共有する、もう 1 つの作業ディレクトリ（git worktree add で作る）。
// 一覧を取り、1 つずつ「守る / 消す」を判定して、消せるものを削除する
export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  opts: Opts = {},
): Promise<WorktreeCleanupResult> {
  const { main, others } = await listWorktrees(opts);
  const mainPath = main ? main.canon : "";
  const current = canonical(opts.cwd ?? process.cwd());
  const context: HarvestContext = { base, current, flags, mainPath, opts };
  const outcomes: WorktreeOutcome[] = [];

  // 並列化しない: git の index.lock 競合と results の順序を守るため直列 await
  for (const rec of others) {
    // ディレクトリごと消された prunable worktree は prune に任せ、表示にも生存にも含めない
    // （含めると存在しない dir への git -C が失敗し「files-changed で kept」と虚偽表示になる）
    if (!existsSync(rec.path)) {
      continue;
    }
    outcomes.push({ rec, result: await harvestOne(rec, context) });
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const results = outcomes.map((outcome) => outcome.result);
  const failures = results.filter((r) => r.action === "failed").length;
  // 生存 = main + kept + failed（would-remove / removed は消えるもの扱い）
  const survivors = [
    ...(main ? [main] : []),
    ...outcomes
      .filter((o) => o.result.action === "kept" || o.result.action === "failed")
      .map((o) => o.rec),
  ];
  // branch 掃除へは「生存 worktree が checkout 中の branch 名」だけを引き継ぐ
  const survivingBranches = new Set<string>();

  for (const rec of survivors) {
    if (rec.branch !== undefined) {
      survivingBranches.add(rec.branch);
    }
  }

  return { failures, results, survivingBranches };
}

// yolo は flags に展開済みなので判定に yolo 分岐は無い
export function decideWorktree(info: WorktreeInfo, flags: Flags): CleanupDecisionResult {
  if (info.invariantReason) {
    return { reason: info.invariantReason, remove: false };
  }

  // detached = branch を持たない worktree。消すと commit を指す参照ごと失われ復元できない
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
  // --porcelain はスクリプト向けの固定書式。エントリごとに空行区切りで、
  // 各エントリは worktree 行（パス）+ 任意の branch / locked 行
  const records = out
    .split("\n\n")
    .map((block) => parseWorktreeBlock(block))
    .filter((rec) => rec.path !== "");
  // git の保証: porcelain は先頭エントリが main worktree
  const [main, ...others] = records;

  return { main, others };
}

// 1 worktree → 1 結果。fail-soft の catch を内側に持ち、呼び出し側へは throw しない契約
async function harvestOne(rec: WtRecord, context: HarvestContext): Promise<ActionResult> {
  try {
    const invariantReason = invariantOf(rec, context);
    // invariant 確定時は decide が値を読まないので probe（git 3 連発）を省略する。
    // hasUncommitted は throw しないため exit code にも影響しない（classifyBranch の throw → failed は維持）
    const hasUncommittedChanges =
      invariantReason === undefined ? await hasUncommitted(rec.path) : false;
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

    // 未コミットを承知で消す（--files-changed 到達）時だけ --force。
    // それ以外は git の最終検証に任せる（probe 後の変化や submodule 内の未 push commit を git が拒否してくれる）
    return await removeWorktree(rec.path, context.opts, hasUncommittedChanges);
  } catch (error) {
    // 1 件の throw（壊れた ref で classifyBranch が rev-parse 失敗 等）で全体を止めない
    return { action: "failed", error: String(error), name: rec.path };
  }
}

// 「未コミットの作業があるか」を、変更が置かれうる 3 か所すべてで調べる
async function hasUncommitted(wt: string): Promise<boolean> {
  // 編集したがまだ commit していないファイル。HEAD = 最後の commit との差分で見る
  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "HEAD"]))) {
    return true;
  }

  // git add でステージしたが commit していない変更
  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "--cached"]))) {
    return true;
  }
  // まだ一度も git add していない新規ファイル。.gitignore 対象は除く
  const others = await git(["-C", wt, "ls-files", "--others", "--exclude-standard"]);

  return others.stdout.trim().length > 0;
}

// 絶対に消してはいけない worktree の判定。該当すれば理由ラベルを返す（どのフラグでも上書き不可）
function invariantOf(rec: WtRecord, context: HarvestContext): string | undefined {
  // { main, others } 分割で構造上ここには来ないはずだが、誤削除防止の防御層として残す
  if (rec.canon === context.mainPath) {
    return "main";
  }

  // cwd が worktree 直下でもサブディレクトリでも current 扱い
  if (isInside({ child: context.current, parent: rec.canon })) {
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

// 競合 rescue とエラー整形だけを持つ実行関数。
// git worktree remove は未コミット変更がある worktree を拒否する。--force はその安全確認を飛ばす
async function removeWorktree(path: string, opts: Opts, force: boolean): Promise<ActionResult> {
  const args = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path];
  const { code, stderr } = await git(args, opts);

  // "is not a working tree" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("is not a working tree")) {
    return { action: "removed", name: path };
  }

  return { action: "failed", error: `exit ${String(code)}: ${stderr.trim()}`, name: path };
}

// worktree を SAFETY ladder のどの段に置くか。未コミット変更が最優先（消すと復元できないため）
function worktreeStage(info: WorktreeInfo): Stage {
  if (info.hasUncommittedChanges) {
    return "files-changed";
  }

  if (info.isMerged) {
    return "merged";
  }

  return "committed";
}
