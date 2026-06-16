import { existsSync } from "node:fs";
import type { Flags, WorktreeActionResult, WorktreeCleanupResult } from "./types";
import { hasRunningClaudeSession, scopeOfPath } from "./agent";
import { git, gitText } from "./git";
import { isMerged, isUntouched } from "./merged";
import { canonical, isInside } from "./path";

export type WtRecord = { branch: string | undefined; canon: string; locked: boolean; path: string };

type Opts = { cwd?: string };

// worktree = 同じリポジトリの履歴を共有する、もう 1 つの作業ディレクトリ（git worktree add で作る）。
// 一覧を取り、1 つずつ「守る → 状態を判定 → 対応する削除関数」と上から下りる
export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  opts: Opts = {},
): Promise<WorktreeCleanupResult> {
  const all = await listWorktrees(opts);
  // porcelain の先頭は main worktree。常に生存し、その checkout branch は mainBranch として branch 掃除へ渡す
  const [mainWorktree, ...linkedWorktrees] = all;
  const current = canonical(opts.cwd ?? process.cwd());
  const results: WorktreeActionResult[] = [];

  // 並列化しない: git の index.lock 競合と results の順序を守るため直列 await
  for (const worktree of linkedWorktrees) {
    // ディレクトリごと消された prunable worktree は prune に任せ、結果に含めない
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
        results.push(await removeDetached(worktree, flags.detached, flags.dryRun, opts));
        continue;
      }
      // 状態を上から1つずつ判定し、対応する削除関数を即実行する。
      // committed / files-changed は、この worktree の scope が対象に入っているかを渡す
      const scope = scopeOfPath(worktree.path);
      const refs = { base, branch: worktree.branch };

      // 未コミットの変更が最優先（消すと復元できない）
      if (await hasUncommittedChanges(worktree.path)) {
        results.push(await removeFilesChanged(worktree, flags.filesChanged.includes(scope), flags.dryRun, opts));
        continue;
      }

      // 独自コミット無し（off-ladder）。--untouched でだけ消す
      if (await isUntouched(refs, opts)) {
        results.push(await removeUntouched(worktree, flags.untouched, flags.dryRun, opts));
        continue;
      }

      if (await isMerged(refs, opts)) {
        results.push(await removeMerged(worktree, flags.dryRun, opts));
        continue;
      }

      // どれでもない = 未マージの独自コミットあり（committed）
      results.push(await removeCommitted(worktree, flags.committed.includes(scope), flags.dryRun, opts));
    } catch (error) {
      // 1 件の throw（壊れた ref で rev-parse 失敗 等）で全体を止めない
      results.push({ action: "failed", branch: worktree.branch, message: String(error), path: worktree.path });
    }
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const failures = results.filter((r) => r.action === "failed").length;

  // main worktree は常に生存。その checkout branch を branch 掃除へ引き継ぐ（使用中の branch を誤って消さない）
  return { failures, mainBranch: mainWorktree?.branch, results };
}

// 「未コミットの作業があるか」を git status --porcelain 1 回で調べる。
// porcelain は編集・ステージ・未追跡（.gitignore 対象は除く）をまとめて 1 行ずつ出す。
// -unormal は status.showUntrackedFiles=no 設定を上書きし、未追跡ファイルを必ず数える
// （旧 3 コマンド版と同じく config に依存させない）。出力が空でなければ未コミットの変更あり
export async function hasUncommittedChanges(wt: string): Promise<boolean> {
  const { stdout } = await git(["-C", wt, "status", "--porcelain", "-unormal"]);

  return stdout.trim().length > 0;
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

// committed の worktree。scope が --committed の対象なら消す（force 不要）、無ければ理由付きで残す
export async function removeCommitted(
  worktree: WtRecord,
  isTarget: boolean,
  dryRun: boolean,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (!isTarget) {
    return { action: "kept", branch: worktree.branch, message: "committed", path: worktree.path };
  }

  if (dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, false);
}

// detached（branch 無し）の worktree。--detached があれば消す、無ければ理由付きで残す。
// detached は未コミット変更を持ちうるので、その場合は force（commit を指す参照ごと失われる前提）
export async function removeDetached(
  worktree: WtRecord,
  detached: boolean,
  dryRun: boolean,
  opts: Opts = {},
): Promise<WorktreeActionResult> {
  if (!detached) {
    return { action: "kept", branch: worktree.branch, message: "detached", path: worktree.path };
  }

  if (dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }
  const dirty = await hasUncommittedChanges(worktree.path);

  return removeWorktree(worktree, opts, dirty);
}

// files-changed の worktree。scope が --files-changed の対象なら消す（未コミットごと force）、無ければ残す
export async function removeFilesChanged(
  worktree: WtRecord,
  isTarget: boolean,
  dryRun: boolean,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (!isTarget) {
    return { action: "kept", branch: worktree.branch, message: "files-changed", path: worktree.path };
  }

  if (dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, true);
}

// merged の worktree は安全（base 取り込み済み）なので、どの scope でも常に消す（force 不要）
export async function removeMerged(
  worktree: WtRecord,
  dryRun: boolean,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, false);
}

// untouched（独自コミット無し）の worktree。--untouched があれば消す、無ければ理由付きで残す。
// 呼び出し側が hasUncommittedChanges を先に見て clean を確定済みなので force は不要
export async function removeUntouched(
  worktree: WtRecord,
  untouched: boolean,
  dryRun: boolean,
  opts: Opts = {},
): Promise<WorktreeActionResult> {
  if (!untouched) {
    return { action: "kept", branch: worktree.branch, message: "untouched", path: worktree.path };
  }

  if (dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, false);
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
async function removeWorktree(
  worktree: WtRecord,
  opts: Opts,
  force: boolean,
): Promise<WorktreeActionResult> {
  const args = force
    ? ["worktree", "remove", "--force", worktree.path]
    : ["worktree", "remove", worktree.path];
  const { code, stderr } = await git(args, opts);

  // "is not a working tree" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("is not a working tree")) {
    return { action: "removed", branch: worktree.branch, path: worktree.path };
  }

  return {
    action: "failed",
    branch: worktree.branch,
    message: `exit ${String(code)}: ${stderr.trim()}`,
    path: worktree.path,
  };
}
