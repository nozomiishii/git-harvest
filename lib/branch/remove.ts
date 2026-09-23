import type { BranchActionResult } from "../types";
import { git } from "../git/exec";

interface Opts {
  cwd?: string;
}

/**
 * 未マージのブランチを指定フラグに応じて削除または保持する。
 * dryRun と enabled を取り違えないようオブジェクトで受け取る。
 *
 * @param name - 対象のブランチ名。
 *
 * @param args - 削除を有効にするかと dry-run の指定。
 *
 * @param args.dryRun - 削除せず予定だけ返す指定。
 *
 * @param args.enabled - この状態の対象を削除する指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または保持の結果。
 */
export async function removeCommittedBranch(
  name: string,
  args: { dryRun: boolean; enabled: boolean },
  opts: Opts,
): Promise<BranchActionResult> {
  if (!args.enabled) {
    return { action: "kept", message: "committed", name };
  }

  if (args.dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

/**
 * 取り込み済みのブランチを削除対象にする。
 *
 * @param name - 対象のブランチ名。
 *
 * @param isDryRun - 削除せず予定だけ返す指定。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 削除または削除予定の結果。
 */
export async function removeMergedBranch(
  name: string,
  isDryRun: boolean,
  opts: Opts,
): Promise<BranchActionResult> {
  if (isDryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

/**
 * Git でブランチを削除し、競合と失敗を結果に変換する。
 * 呼び出し元が削除対象と判断したブランチを branch -D で消す。
 * 取り込み済みのほか、--committed=branch で許可された未マージのブランチも対象になる。
 * 先に別プロセスが削除した場合も成功として扱う。
 *
 * @param name - 対象のブランチ名。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns ブランチ削除の結果。
 */
async function removeBranch(name: string, opts: Opts): Promise<BranchActionResult> {
  const { code, stderr } = await git(["branch", "-D", name], opts);

  // "not found" は別プロセスが先に消した後で、本来の目的（消える）は達成済みなので removed 扱い
  if (code === 0 || stderr.includes("not found")) {
    return { action: "removed", name };
  }

  return { action: "failed", message: `exit ${String(code)}: ${stderr.trim()}`, name };
}
