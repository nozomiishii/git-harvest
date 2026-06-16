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
