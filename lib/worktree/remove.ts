import type { WorktreeActionResult } from "../types";
import type { WtRecord } from "./list";
import { git } from "../git/exec";
import { hasUncommittedChanges } from "./uncommitted";

interface Opts {
  cwd?: string;
}

// remove* に共通する引数。boolean が並ぶと取り違えやすいのでオブジェクト化している。
// enabled: 対応するフラグがこの worktree を消す対象に含めているか
// dryRun:  実際に削除せず would-remove を返すか
interface RemoveArgs {
  dryRun: boolean;
  enabled: boolean;
}

/**
 * 未マージの worktree を指定フラグに応じて削除または保持する。
 * 有効時は強制削除せず、無効時は理由を添えて残す。
 *
 * @param worktree - 削除または保持する worktree。
 *
 * @param args - 削除を有効にするかと dry-run の指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または保持の結果。
 */
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

/**
 * detached worktree を指定フラグに応じて削除または保持する。
 * 未コミット変更があれば強制削除する。ブランチ参照がなく復元できない変更もある。
 *
 * @param worktree - 削除または保持する worktree。
 *
 * @param args - 削除を有効にするかと dry-run の指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または保持の結果。
 */
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
  const isDirty = await hasUncommittedChanges(worktree.path);

  return removeWorktree(worktree, opts, isDirty);
}

/**
 * 未コミット変更がある worktree を指定フラグに応じて削除または保持する。
 * 有効時は未コミット変更ごと強制削除する。
 *
 * @param worktree - 削除または保持する worktree。
 *
 * @param args - 削除を有効にするかと dry-run の指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または保持の結果。
 */
export async function removeFilesChanged(
  worktree: WtRecord,
  args: RemoveArgs,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (!args.enabled) {
    return {
      action: "kept",
      branch: worktree.branch,
      message: "files-changed",
      path: worktree.path,
    };
  }

  if (args.dryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, true);
}

/**
 * 取り込み済みの worktree を削除対象にする。
 * 有効化フラグは持たず、dry-run だけを確認する。
 *
 * @param worktree - 削除または保持する worktree。
 *
 * @param isDryRun - 削除せず予定だけ返す指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または削除予定の結果。
 */
export async function removeMerged(
  worktree: WtRecord,
  isDryRun: boolean,
  opts: Opts,
): Promise<WorktreeActionResult> {
  if (isDryRun) {
    return { action: "would-remove", branch: worktree.branch, path: worktree.path };
  }

  return removeWorktree(worktree, opts, false);
}

/**
 * 独自コミットのない worktree を指定フラグに応じて削除または保持する。
 * 呼び出し元が未コミット変更のない状態を確認しているため強制削除しない。
 *
 * @param worktree - 削除または保持する worktree。
 *
 * @param args - 削除を有効にするかと dry-run の指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または保持の結果。
 */
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

/**
 * Git で worktree を削除し、競合と失敗を結果に変換する。
 * 呼び出し元が未コミット変更を強制削除してよいか決めてから渡す。
 * 先に別プロセスが削除した場合も成功として扱う。
 *
 * @param worktree - 削除する worktree。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @param shouldForce - 未コミット変更も含めて強制削除する指定。
 *
 * @returns worktree 削除の結果。
 */
async function removeWorktree(
  worktree: WtRecord,
  opts: Opts,
  shouldForce: boolean,
): Promise<WorktreeActionResult> {
  const args = shouldForce
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
