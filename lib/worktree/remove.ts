import { git } from "../git/exec";
import type { WorktreeActionResult } from "../types";
import type { WtRecord } from "./list";
import { hasUncommittedChanges } from "./uncommitted";

type Opts = { cwd?: string };

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

// detached（branch を持たない）worktree。--detached があれば消す、無ければ理由付きで残す。
// detached は未コミット変更を含むこともあり、その場合は force で消す
// （branch という参照が無い以上、未コミット分は復元できない前提の動作）
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
