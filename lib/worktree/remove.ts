import { git } from "../git/exec";
import type { WorktreeActionResult } from "../types";
import type { WtRecord } from "./list";
import { hasUncommittedChanges } from "./uncommitted";

type Opts = { cwd?: string };

// remove* に共通する引数。boolean が並ぶと取り違えやすいのでオブジェクト化している。
// enabled: 対応するフラグがこの worktree を消す対象に含めているか
// dryRun:  実際に削除せず would-remove を返すか
type RemoveArgs = { dryRun: boolean; enabled: boolean };

// committed の worktree。enabled なら消す（force 不要）、外せば理由付きで残す
export async function removeCommitted(
  worktree: WtRecord,
  args: RemoveArgs,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (!args.enabled) {
    return { action: "kept", branch: worktree.branch, message: "committed", path: worktree.path };
  }

  if (args.dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, false);
}

// detached（branch を持たない）worktree。enabled なら消す、外せば理由付きで残す。
// detached は未コミット変更を含むこともあり、その場合は force で消す
// （branch という参照が無い以上、未コミット分は復元できない前提の動作）
export async function removeDetached(
  worktree: WtRecord,
  args: RemoveArgs,
  opts: Opts = {},
): Promise<WorktreeActionResult> {
  if (!args.enabled) {
    return { action: "kept", branch: worktree.branch, message: "detached", path: worktree.path };
  }

  if (args.dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }
  const dirty = await hasUncommittedChanges(worktree.path);

  return removeWorktree(worktree, opts, dirty);
}

// files-changed の worktree。enabled なら消す（未コミットごと force）、外せば残す
export async function removeFilesChanged(
  worktree: WtRecord,
  args: RemoveArgs,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (!args.enabled) {
    return { action: "kept", branch: worktree.branch, message: "files-changed", path: worktree.path };
  }

  if (args.dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, true);
}

// merged の worktree は安全（base 取り込み済み）なので常に消す。
// enabled で切り替える余地が無いので dryRun だけを受ける
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

// untouched（独自コミット無し）の worktree。enabled なら消す、外せば理由付きで残す。
// 呼び出し側が hasUncommittedChanges を先に見て clean を確定済みなので force は不要
export async function removeUntouched(
  worktree: WtRecord,
  args: RemoveArgs,
  opts: Opts = {},
): Promise<WorktreeActionResult> {
  if (!args.enabled) {
    return { action: "kept", branch: worktree.branch, message: "untouched", path: worktree.path };
  }

  if (args.dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, false);
}

// 実際に worktree を消すだけの関数。並走している別プロセスとの競合を救済し、
// 残ったエラーを呼び出し側が読める形に整える。
// git worktree remove は未コミット変更が残っている worktree を既定では拒否する。
// --force はその安全確認を飛ばすので、上の remove* が「force して良いか」を判断してから渡す
async function removeWorktree(
  worktree: WtRecord,
  opts: Opts,
  force: boolean,
): Promise<WorktreeActionResult> {
  const args = force
    ? ["worktree", "remove", "--force", worktree.path]
    : ["worktree", "remove", worktree.path];
  const { code, stderr } = await git(args, opts);

  // "is not a working tree" は別プロセスが先に消した後で、本来の目的（消える）は達成済みなので removed 扱い
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
