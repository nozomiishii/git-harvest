import { existsSync } from "node:fs";
import type { ActionResult, Flags, ScopeFlags, Stage, WorktreeCleanupResult } from "./types";
import { hasRunningClaudeSession, scopeOfPath } from "./agent";
import { git, gitText } from "./git";
import { isMerged, isUntouched } from "./merged";
import { canonical, isInside } from "./path";
import { WORKTREE_SCOPES } from "./types";

// scope ごとの削除候補。category は files-changed / committed / merged のいずれか
// （untouched は off-ladder として candidates に積まず、sweepOffLadder で処理する）
export type Removable = { category: Stage; worktree: WtRecord };

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
// 一覧を取り、1 つずつ「守る / 分類」し、scope ごとにフラグで「どこまで消すか」を決めて削除する
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
  const candidates: Record<"claude-worktree" | "worktree", Removable[]> = {
    "claude-worktree": [],
    worktree: [],
  };
  // 生存 = kept / failed（物理的に残る）。result を積み、生存なら survivors にも積む
  const record = (worktree: WtRecord, result: ActionResult): void => {
    results.push(result);

    if (result.action === "kept" || result.action === "failed") {
      survivors.push(worktree);
    }
  };

  // 並列化しない: git の index.lock 競合と results の順序を守るため直列 await
  for (const worktree of linked) {
    // ディレクトリごと消された prunable worktree は prune に任せ、表示にも生存にも含めない
    if (!existsSync(worktree.path)) {
      continue;
    }

    try {
      const keep = keepReason(worktree, base, current);

      if (keep !== undefined) {
        record(worktree, { action: "kept", name: worktree.path, reason: keep });
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
      candidates[scopeOfPath(worktree.path)].push({ category, worktree });
    } catch (error) {
      // 1 件の throw（壊れた ref で rev-parse 失敗 等）で全体を止めない
      record(worktree, { action: "failed", error: String(error), name: worktree.path });
    }
  }

  for (const scope of WORKTREE_SCOPES) {
    const items = candidates[scope];
    const byPath = new Map(items.map((it) => [it.worktree.path, it.worktree]));

    for (const result of await removeForScope(items, flags[scope], flags.dryRun, opts)) {
      // result.name は candidates 由来の path なので rec は必ず引ける
      const rec = byPath.get(result.name);

      if (rec !== undefined) {
        record(rec, result);
      }
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

// 絶対に消してはいけない worktree の判定。該当すれば理由ラベルを返す（どのフラグでも上書き不可）。
// main は listWorktrees が先頭分離するためここに来ず、判定不要
export function keepReason(worktree: WtRecord, base: string, current: string): string | undefined {
  // cwd が worktree 直下でもサブディレクトリでも current 扱い
  if (isInside({ child: current, parent: worktree.canon })) {
    return "current";
  }

  if (worktree.branch === base) {
    return "base branch";
  }

  if (worktree.locked) {
    return "locked";
  }

  if (hasRunningClaudeSession(worktree.path)) {
    return "session running";
  }

  return undefined;
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

// scope ごとに、そのフラグで「どこまで消すか」を 1 回選ぶ累積実行関数。
// 消されなかった（より危険な段の）worktree は理由＝カテゴリで kept として返す
export async function removeForScope(
  items: Removable[],
  scopeFlags: ScopeFlags,
  dryRun: boolean,
  opts: Opts = {},
): Promise<ActionResult[]> {
  const removed = scopeFlags.filesChanged
    ? await removeFilesChanged(items, dryRun, opts)
    : scopeFlags.committed
      ? await removeCommitted(items, dryRun, opts)
      : await removeMerged(items, dryRun, opts);
  const handled = new Set(removed.map((r) => r.name));
  const kept: ActionResult[] = [];

  for (const { category, worktree } of items) {
    if (handled.has(worktree.path)) {
      continue;
    }
    kept.push({ action: "kept", name: worktree.path, reason: category });
  }

  return [...removed, ...kept];
}

// off-ladder（detached / untouched）の削除 or kept。toggle が立っていれば消し、無ければ理由付きで残す。
// detached は未コミット変更を持ちうるので dirty なら force。untouched は定義上 clean なので force 無し
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

// 指定カテゴリの worktree だけを消す。fail-soft は各削除で 1 件 failed に閉じる
async function removeCategory(
  items: Removable[],
  category: Stage,
  dryRun: boolean,
  opts: Opts,
  force: boolean,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const { worktree } of items.filter((it) => it.category === category)) {
    if (dryRun) {
      results.push({ action: "would-remove", name: worktree.path });
      continue;
    }

    try {
      results.push(await removeWorktree(worktree.path, opts, force));
    } catch (error) {
      results.push({ action: "failed", error: String(error), name: worktree.path });
    }
  }

  return results;
}

// merged + committed を消す
async function removeCommitted(
  items: Removable[],
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult[]> {
  return [
    ...(await removeMerged(items, dryRun, opts)),
    ...(await removeCategory(items, "committed", dryRun, opts, false)),
  ];
}

// merged + committed + files-changed を消す（files-changed は未コミットを承知で force）
async function removeFilesChanged(
  items: Removable[],
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult[]> {
  return [
    ...(await removeCommitted(items, dryRun, opts)),
    ...(await removeCategory(items, "files-changed", dryRun, opts, true)),
  ];
}

// merged を消す（force 不要）
async function removeMerged(
  items: Removable[],
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult[]> {
  return removeCategory(items, "merged", dryRun, opts, false);
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
