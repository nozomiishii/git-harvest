import { realpathSync } from 'node:fs';
import type { Classification, CleanupDecision, CleanupResult, Flags, Stage } from './types';
import { hasRunningClaudeSession, isClaudeManagedWorktree } from './claude';
import { gitExitOk, gitText } from './git';
import { classifyBranch } from './merge-detect';
import { atOrSafer } from './types';

// 1 worktree の状態をまとめた内部型。判定関数はこの型だけを見る。
export type WorktreeInfo = {
  branch: null | string; // checkout 中の branch 名。detached なら null
  classification: Classification | null; // branch があれば classifyBranch 結果、なければ null
  hasUncommittedChanges: boolean; // 未コミットの変更があるか
  isBaseBranch: boolean; // branch === base か
  isClaudeManaged: boolean; // .claude/worktrees/ 配下か
  isCurrent: boolean; // カレント cwd がこの worktree 配下（subdir 含む）か
  isMain: boolean; // リスト先頭 = 主 worktree か
  locked: boolean; // git worktree lock 済みか（porcelain の locked 行）
  path: string; // git が保持する worktree path（canonical 化前の生値）
  sessionRunning: boolean; // 走行中 Claude session があるか
};

// porcelain の 1 ブロックを表す中間型。
type PorcelainEntry = {
  branch: null | string;
  locked: boolean;
  path: string;
};

// worktree を整理する。dryRun なら would-remove / kept のみ。
// 実削除は1件ずつ try/catch で隔離し、1件失敗しても続行する。
// survivingPaths = 全 worktree path − 削除した（dryRun なら削除予定の）path。
export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  cwd?: string,
): Promise<CleanupResult & { survivingPaths: string[] }> {
  const infos = await collectWorktrees(base, cwd);

  const result: CleanupResult & { survivingPaths: string[] } = {
    failures: 0,
    results: [],
    survivingPaths: [],
  };

  // 削除対象（dryRun でも本番でも同じ集合）の path 集合。
  const removedPaths = new Set<string>();
  let didRemove = false;

  for (const wt of infos) {
    // 主 worktree は表示も削除もしない（bash 同様、サマリー対象外）。
    if (wt.isMain) continue;

    const decision = decideWorktree(wt, flags);

    if (!decision.remove) {
      result.results.push({ action: 'kept', name: wt.path, reason: decision.reason });
      continue;
    }

    if (flags.dryRun) {
      result.results.push({ action: 'would-remove', name: wt.path });
      removedPaths.add(wt.path);
      continue;
    }

    // 実削除: 未コミット変更があるときだけ --force。
    const args = ['worktree', 'remove'];

    if (wt.hasUncommittedChanges) args.push('--force');
    args.push(wt.path);

    try {
      await gitText(args, { cwd });
      result.results.push({ action: 'removed', name: wt.path });
      removedPaths.add(wt.path);
      didRemove = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // 手動 rm 済みの stale entry は目的達成済みの no-op として success に正規化。
      if (isStaleRemoveError(message)) {
        result.results.push({ action: 'removed', name: wt.path });
        removedPaths.add(wt.path);
        didRemove = true;
      } else {
        result.results.push({ action: 'failed', error: message, name: wt.path });
        result.failures += 1;
      }
    }
  }

  // 実削除後に stale 管理情報を一度整理する（user-visible なので必須）。
  if (didRemove) {
    try {
      await gitText(['worktree', 'prune'], { cwd });
    } catch {
      // prune 失敗は致命でない。サマリーには影響させない。
    }
  }

  // 生存 worktree = 全 worktree − 削除（予定）の path。主 worktree も含む。
  result.survivingPaths = infos.map((wt) => wt.path).filter((p) => !removedPaths.has(p));

  return result;
}

// 全 worktree の情報を集める。base はカレント cwd 解決と branch 分類の土台。
// cwd を省略するとカレントディレクトリ基準で git を呼ぶ。
export async function collectWorktrees(base: string, cwd?: string): Promise<WorktreeInfo[]> {
  const porcelain = await gitText(['worktree', 'list', '--porcelain'], { cwd });
  const entries = parsePorcelain(porcelain);

  // カレント worktree の判定基準: cwd を canonical 化した path。
  const currentCanon = canonicalPath(cwd ?? process.cwd());

  const infos: WorktreeInfo[] = [];

  for (const [i, entry_] of entries.entries()) {
    const entry = entry_;
    const wtCanon = canonicalPath(entry.path);

    // cwd が worktree path 配下（subdir 含む）なら current 扱い。
    const isCurrent =
      currentCanon === wtCanon || currentCanon.startsWith(`${wtCanon}/`);

    // branch があれば base に対して分類する。分類は base cwd で実行（branch は global ref）。
    let classification: Classification | null = null;

    if (entry.branch) {
      classification = await classifyBranch(base, entry.branch, { cwd });
    }

    infos.push({
      branch: entry.branch,
      classification,
      hasUncommittedChanges: await hasUncommittedChanges(entry.path),
      isBaseBranch: entry.branch === base,
      isClaudeManaged: isClaudeManagedWorktree(entry.path),
      isCurrent,
      isMain: i === 0,
      locked: entry.locked,
      path: entry.path,
      sessionRunning: await hasRunningClaudeSession(entry.path),
    });
  }

  return infos;
}

// この worktree を削除すべきか（真偽だけ）。保護理由も要るときは decideWorktree を使う。
export function shouldDeleteWorktree(wt: WorktreeInfo, flags: Flags): boolean {
  return decideWorktree(wt, flags).remove;
}

// worktree が含まれる最もリスクの高い stage を返す。
// 前提: branch あり（detached は shouldDeleteWorktree が先に処理する）。
//   未コミット変更あり → files-changed（branch が merged でも最優先）
//   classification === merged → merged
//   それ以外 → committed
export function worktreeStage(wt: WorktreeInfo): Stage {
  if (wt.hasUncommittedChanges) return 'files-changed';

  if (wt.classification === 'merged') return 'merged';

  return 'committed';
}

// パスを canonical（symlink 解決済み）に正規化する。解決できなければ原文を返す。
// git は worktree path を canonical で保持するが、cwd は symlink 経由のことがあるため揃える。
function canonicalPath(p: string): string {
  if (!p) return p;

  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// 削除するか、しないなら保護理由は何か。削除可否と理由を1か所で決め、両者がずれないようにする。
// 判定順は issue の pseudo-code に厳密一致。
function decideWorktree(wt: WorktreeInfo, flags: Flags): CleanupDecision {
  // invariant: 主 worktree / base branch の worktree は消さない。
  if (wt.isMain || wt.isBaseBranch) return { reason: 'base worktree', remove: false };

  // invariant: カレント worktree（cwd）は消すと自爆するので消さない。
  if (wt.isCurrent) return { reason: 'current worktree', remove: false };

  // invariant: 走行中 session のある worktree は消さない。
  if (wt.sessionRunning) return { reason: 'session running', remove: false };

  // invariant: locked worktree は消さない。
  if (wt.locked) return { reason: 'locked', remove: false };

  // detached HEAD: branch が無く stage 分類できない。専用フラグでのみ削除。
  if (!wt.branch) {
    const deletable = wt.isClaudeManaged ? flags.claudeWorktreeDetached : flags.worktreeDetached;

    return deletable ? { remove: true } : { reason: 'detached (use --worktree-detached)', remove: false };
  }

  // untouched: 独自コミットなし・clean（base と同一）。ladder 外。専用フラグでのみ削除。
  if (wt.classification === 'untouched' && !wt.hasUncommittedChanges) {
    const deletable = wt.isClaudeManaged ? flags.claudeWorktreeUntouched : flags.worktreeUntouched;

    return deletable ? { remove: true } : { reason: 'untouched (use --worktree-untouched)', remove: false };
  }

  // stage を閾値と比較。閾値以降（より安全側）なら削除。
  const threshold = wt.isClaudeManaged ? flags.claudeWorktree : flags.worktree;
  const stage = worktreeStage(wt);

  if (atOrSafer(stage, threshold)) return { remove: true };

  return stage === 'files-changed'
    ? { reason: 'files-changed (use --worktree-files-changed)', remove: false }
    : { reason: 'committed (use --worktree-committed)', remove: false };
}

// worktree に未コミットの変更があるか。
// bash の has_uncommitted_changes 移植: diff HEAD / diff --cached / ls-files --others --exclude-standard。
async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  // 追跡ファイルの作業ツリー差分。
  if (!(await gitExitOk(['-C', worktreePath, 'diff', '--quiet', 'HEAD']))) return true;

  // ステージ済み差分。
  if (!(await gitExitOk(['-C', worktreePath, 'diff', '--quiet', '--cached']))) return true;

  // 未追跡ファイル。
  try {
    const untracked = await gitText(['-C', worktreePath, 'ls-files', '--others', '--exclude-standard']);

    if (untracked !== '') return true;
  } catch {
    // 取得できなければ未追跡なしとみなす。
  }

  return false;
}

// stale エラー（手動 rm 済みの管理情報など）を success に正規化するための判定。
function isStaleRemoveError(message: string): boolean {
  return /is not a working tree|No such file or directory|not a valid path/i.test(message);
}

// `git worktree list --porcelain` をパースする。
// ブロックは空行区切り。`worktree ` 以降を substr で丸ごと取り、path のスペースを壊さない。
// branch 行があれば refs/heads/ を剝がす。detached 行のみなら branch=null。locked 行で locked=true。
function parsePorcelain(text: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  let current: null | PorcelainEntry = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      // 新しいブロック開始。直前のブロックを確定する。
      if (current) entries.push(current);
      current = { branch: null, locked: false, path: line.slice('worktree '.length) };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true;
    }
  }

  if (current) entries.push(current);

  return entries;
}
