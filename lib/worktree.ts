import { existsSync } from "node:fs";
import type { ActionResult, Flags, ScopeFlags, Stage, WorktreeCleanupResult } from "./types";
import { hasRunningClaudeSession, scopeOfPath } from "./agent";
import { git, gitText } from "./git";
import { isMerged, isUntouched } from "./merged";
import { canonical, isInside } from "./path";

export type WtRecord = { branch: string | undefined; canon: string; locked: boolean; path: string };

type Opts = { cwd?: string };

// 仕様カテゴリだけ返す（branch を持つ前提）。未コミット変更が最優先（消すと復元できないため）
export async function categorize(
  worktree: WtRecord,
  base: string,
  opts: Opts = {},
): Promise<"untouched" | Stage> {
  if (await hasUncommittedChanges(worktree.path)) {
    return "files-changed";
  }
  const { branch } = worktree;

  // detached（branch 無し）は呼び出し側で除外済み。型を満たすためのガードで、実際にはここに来ない
  if (branch === undefined) {
    return "committed";
  }
  const refs = { base, branch };

  if (await isUntouched(refs, opts)) {
    return "untouched";
  }

  return (await isMerged(refs, opts)) ? "merged" : "committed";
}

// worktree = 同じリポジトリの履歴を共有する、もう 1 つの作業ディレクトリ（git worktree add で作る）。
// 一覧を取り、1 つずつ「守る → 分類 → category に対応した削除関数」と上から下りる
export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  opts: Opts = {},
): Promise<WorktreeCleanupResult> {
  const all = await listWorktrees(opts);
  // porcelain の先頭は main worktree。常に生存し、その checkout branch も branch 掃除へ引き継ぐ
  const [mainWorktree, ...linked] = all;
  const current = canonical(opts.cwd ?? process.cwd());
  const results: ActionResult[] = [];
  const survivors: WtRecord[] = mainWorktree ? [mainWorktree] : [];
  // 生存 = kept / failed（物理的に残る）。result を積み、生存なら survivors にも積む
  const record = (worktree: WtRecord, result: ActionResult): void => {
    results.push(result);

    if (result.action === "kept" || result.action === "failed") {
      survivors.push(worktree);
    }
  };
  // 守る理由が当たった worktree を、その理由で kept にする
  const keepWorktree = (worktree: WtRecord, reason: string): void => {
    record(worktree, { action: "kept", name: worktree.path, reason });
  };

  // 並列化しない: git の index.lock 競合と results の順序を守るため直列 await
  for (const worktree of linked) {
    // ディレクトリごと消された prunable worktree は prune に任せ、表示にも生存にも含めない
    if (!existsSync(worktree.path)) {
      continue;
    }

    try {
      // 守る理由を上から1つずつ確認。当たればその理由で残す
      if (isCwd(worktree, current)) {
        keepWorktree(worktree, "current");
        continue;
      }

      if (isOnBaseBranch(worktree, base)) {
        keepWorktree(worktree, "base branch");
        continue;
      }

      if (isLocked(worktree)) {
        keepWorktree(worktree, "locked");
        continue;
      }

      if (isSessionRunning(worktree)) {
        keepWorktree(worktree, "session running");
        continue;
      }

      // detached = branch を持たない worktree。off-ladder なので --detached でだけ消す
      if (worktree.branch === undefined) {
        record(
          worktree,
          await sweepOffLadder(worktree, flags.detached, "detached", flags.dryRun, opts),
        );
        continue;
      }
      const category = await categorize(worktree, base, opts);

      // untouched も off-ladder。--untouched でだけ消す
      if (category === "untouched") {
        record(
          worktree,
          await sweepOffLadder(worktree, flags.untouched, "untouched", flags.dryRun, opts),
        );
        continue;
      }
      // category に対応した削除関数を呼ぶ。各関数が「消し方」と結果（removed / kept）を返す
      const scope = flags[scopeOfPath(worktree.path)];

      if (category === "merged") {
        record(worktree, await removeMerged(worktree, flags.dryRun, opts));
        continue;
      }

      if (category === "committed") {
        record(worktree, await removeCommitted(worktree, scope, flags.dryRun, opts));
        continue;
      }

      record(worktree, await removeFilesChanged(worktree, scope, flags.dryRun, opts));
    } catch (error) {
      // 1 件の throw（壊れた ref で rev-parse 失敗 等）で全体を止めない
      record(worktree, { action: "failed", error: String(error), name: worktree.path });
    }
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const failures = results.filter((r) => r.action === "failed").length;
  // branch 掃除へは「生存 worktree が checkout 中の branch 名」だけを引き継ぐ
  const survivingBranches = new Set<string>();

  for (const rec of survivors) {
    if (rec.branch !== undefined) {
      survivingBranches.add(rec.branch);
    }
  }

  return { failures, results, survivingBranches };
}

export async function listWorktrees(opts: Opts = {}): Promise<WtRecord[]> {
  const out = await gitText(["worktree", "list", "--porcelain"], opts);

  // --porcelain はスクリプト向けの固定書式。エントリごとに空行区切りで、
  // 各エントリは worktree 行（パス）+ 任意の branch / locked 行。先頭は main worktree
  return out
    .split("\n\n")
    .map((block) => parseWorktreeBlock(block))
    .filter((rec) => rec.path !== "");
}

// committed の worktree。--committed が立っていれば消す（force 不要）、無ければ理由付きで残す
export async function removeCommitted(
  worktree: WtRecord,
  scope: ScopeFlags,
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult> {
  if (!scope.committed) {
    return { action: "kept", name: worktree.path, reason: "committed" };
  }

  if (dryRun) {
    return { action: "would-remove", name: worktree.path };
  }

  return removeWorktree(worktree.path, opts, false);
}

// files-changed の worktree。--files-changed が立っていれば消す（未コミットを承知で force）、無ければ残す
export async function removeFilesChanged(
  worktree: WtRecord,
  scope: ScopeFlags,
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult> {
  if (!scope.filesChanged) {
    return { action: "kept", name: worktree.path, reason: "files-changed" };
  }

  if (dryRun) {
    return { action: "would-remove", name: worktree.path };
  }

  return removeWorktree(worktree.path, opts, true);
}

// merged の worktree は安全（base 取り込み済み）なので、どの scope でも常に消す（force 不要）
export async function removeMerged(
  worktree: WtRecord,
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult> {
  if (dryRun) {
    return { action: "would-remove", name: worktree.path };
  }

  return removeWorktree(worktree.path, opts, false);
}

// off-ladder（detached / untouched）の削除 or kept。toggle が立っていれば消し、無ければ理由付きで残す。
// 消す前に未コミット変更を見て force を決める。detached は dirty なら force、
// untouched は categorize 済みで clean なので dirty は false（force 無し）になる
export async function sweepOffLadder(
  worktree: WtRecord,
  toggle: boolean,
  reason: string,
  dryRun: boolean,
  opts: Opts = {},
): Promise<ActionResult> {
  if (!toggle) {
    return { action: "kept", name: worktree.path, reason };
  }

  if (dryRun) {
    return { action: "would-remove", name: worktree.path };
  }
  const dirty = await hasUncommittedChanges(worktree.path);

  return removeWorktree(worktree.path, opts, dirty);
}

// 「未コミットの作業があるか」を git status --porcelain 1 回で調べる。
// porcelain は編集・ステージ・未追跡（.gitignore 対象は除く）をまとめて 1 行ずつ出す。
// -unormal は status.showUntrackedFiles=no 設定を上書きし、未追跡ファイルを必ず数える
// （旧 3 コマンド版と同じく config に依存させない）。出力が空でなければ未コミットの変更あり
async function hasUncommittedChanges(wt: string): Promise<boolean> {
  const { stdout } = await git(["-C", wt, "status", "--porcelain", "-unormal"]);

  return stdout.trim().length > 0;
}

// 守る理由ごとの述語。どれか true ならその worktree はどのフラグでも消さない。
// main は listWorktrees が先頭分離するためここに来ず、判定不要。

// cwd が worktree 直下でもサブディレクトリでも current 扱い
function isCwd(worktree: WtRecord, current: string): boolean {
  return isInside({ child: current, parent: worktree.canon });
}

function isLocked(worktree: WtRecord): boolean {
  return worktree.locked;
}

function isOnBaseBranch(worktree: WtRecord, base: string): boolean {
  return worktree.branch === base;
}

function isSessionRunning(worktree: WtRecord): boolean {
  return hasRunningClaudeSession(worktree.path);
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
