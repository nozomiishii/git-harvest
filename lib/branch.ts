import type { Classification, CleanupDecision, CleanupResult, Flags, Stage } from './types';
import { gitText } from './git';
import { classifyBranch } from './merge-detect';
import { atOrSafer } from './types';

// 1 branch の判定に必要な情報をまとめた内部型。
export type BranchInfo = {
  checkedOutInSurviving: boolean; // 生存 worktree が checkout 中か
  classification: Classification; // base に対する分類
  isBase: boolean; // base（default branch）か
  isCurrentHead: boolean; // 現在 HEAD か（git symbolic-ref --short HEAD）
  name: string; // branch 名
};

// branch を base に対する分類から stage に畳む。
// untouched / merged は base にある = merged 相当。other は committed。branch に files-changed は無い。
export function branchStage(classification: Classification): Stage {
  return classification === 'other' ? 'committed' : 'merged';
}

// branch を整理する。survivingWorktreePaths は worktree cleanup 後に生き残った worktree path。
// dryRun なら would-remove / kept のみ。実削除は1件ずつ隔離し、失敗は数えて続行する。
export async function cleanupBranches(
  base: string,
  flags: Flags,
  survivingWorktreePaths: string[],
  cwd?: string,
): Promise<CleanupResult> {
  // branch 一覧。短縮名のみを列挙する。
  const listing = await gitText(['branch', '--format=%(refname:short)'], { cwd });
  const names = listing.split('\n').map((line) => line.trim()).filter(Boolean);

  // 現在 HEAD。detached なら symbolic-ref が失敗するので空扱い。
  let currentHead: string;

  try {
    currentHead = await gitText(['symbolic-ref', '--short', 'HEAD'], { cwd });
  } catch {
    currentHead = '';
  }

  // 生存 worktree が checkout 中の branch 集合。
  const porcelain = await gitText(['worktree', 'list', '--porcelain'], { cwd });
  const checkedOut = checkedOutBranches(porcelain, survivingWorktreePaths);

  const result: CleanupResult = { failures: 0, results: [] };

  for (const name of names) {
    const info: BranchInfo = {
      checkedOutInSurviving: checkedOut.has(name),
      classification: await classifyBranch(base, name, { cwd }),
      isBase: name === base,
      isCurrentHead: name === currentHead,
      name,
    };

    // base は表示も削除もしない（サマリー対象外）。
    if (info.isBase) continue;

    const decision = decideBranch(info, flags);

    if (!decision.remove) {
      result.results.push({ action: 'kept', name, reason: decision.reason });
      continue;
    }

    if (flags.dryRun) {
      result.results.push({ action: 'would-remove', name });
      continue;
    }

    try {
      await gitText(['branch', '-D', name], { cwd });
      result.results.push({ action: 'removed', name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // 既に消えている branch は目的達成済みの no-op として success に正規化。
      if (isAlreadyGoneError(message)) {
        result.results.push({ action: 'removed', name });
      } else {
        result.results.push({ action: 'failed', error: message, name });
        result.failures += 1;
      }
    }
  }

  return result;
}

// この branch を削除すべきか（真偽だけ）。保護理由も要るときは decideBranch を使う。
export function shouldDeleteBranch(info: BranchInfo, flags: Flags): boolean {
  return decideBranch(info, flags).remove;
}

// porcelain から、survivingWorktreePaths の worktree が checkout 中の branch 集合を作る。
// `worktree <path>` ブロックを surviving で絞り、その `branch refs/heads/<name>` を集める。
function checkedOutBranches(porcelain: string, survivingWorktreePaths: string[]): Set<string> {
  const surviving = new Set(survivingWorktreePaths);
  const branches = new Set<string>();
  let inSurviving = false;

  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      const path = line.slice('worktree '.length);
      inSurviving = surviving.has(path);
      continue;
    }

    if (inSurviving && line.startsWith('branch ')) {
      branches.add(line.slice('branch '.length).replace(/^refs\/heads\//, ''));
    }
  }

  return branches;
}

// 削除するか、しないなら保護理由は何か。削除可否と理由を1か所で決め、両者がずれないようにする。
// 判定順は issue の pseudo-code に厳密一致。
function decideBranch(info: BranchInfo, flags: Flags): CleanupDecision {
  // invariant: base branch は消さない。
  if (info.isBase) return { reason: 'base branch', remove: false };

  // invariant: 現在 HEAD は git が拒否するので消さない。
  if (info.isCurrentHead) return { reason: 'current HEAD', remove: false };

  // invariant: 生存 worktree が参照中の branch は git が拒否するので消さない。
  if (info.checkedOutInSurviving) return { reason: 'currently checked out', remove: false };

  // stage を閾値と比較。閾値以降（より安全側）なら削除。
  if (atOrSafer(branchStage(info.classification), flags.branch)) return { remove: true };

  return { reason: 'committed (use --branch-committed)', remove: false };
}

// branch not found 等、削除済み相当のエラーを success に正規化する判定。
function isAlreadyGoneError(message: string): boolean {
  return /not found|Cannot delete branch|isn't a valid branch name/i.test(message);
}

