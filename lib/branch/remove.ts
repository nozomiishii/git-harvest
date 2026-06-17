import { git } from "../git/exec";
import type { BranchActionResult } from "../types";

type Opts = { cwd?: string };

// committed の branch は committed の対象に branch が入っていれば消す、なければ理由付きで残す
export async function removeCommittedBranch(
  name: string,
  isTarget: boolean,
  dryRun: boolean,
  opts: Opts,
): Promise<BranchActionResult> {
  if (!isTarget) {
    return { action: "kept", message: "committed", name };
  }

  if (dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

// merged の branch は base 取り込み済みの残骸なので常に消す
export async function removeMergedBranch(
  name: string,
  dryRun: boolean,
  opts: Opts,
): Promise<BranchActionResult> {
  if (dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

// 実際に branch を消すだけの関数。並走している別プロセスとの競合を救済し、
// 残ったエラーを呼び出し側が読める形に整える。
// branch -D は git 側のマージ済みチェックを飛ばして強制削除する（-d は未マージを拒否）。
// マージ済みかは呼び出し前に isUntouched / isMerged で確認済みなので -D で問題ない
async function removeBranch(name: string, opts: Opts): Promise<BranchActionResult> {
  const { code, stderr } = await git(["branch", "-D", name], opts);

  // "not found" は別プロセスが先に消した後で、本来の目的（消える）は達成済みなので removed 扱い
  if (code === 0 || stderr.includes("not found")) {
    return { action: "removed", name };
  }

  return { action: "failed", message: `exit ${String(code)}: ${stderr.trim()}`, name };
}
