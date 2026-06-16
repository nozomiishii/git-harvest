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

// 競合 rescue とエラー整形だけを持つ実行関数。
// branch -D は「base に取り込み済みか」を git 側で確認しない強制削除（-d は未マージを拒否する）。
// 取り込み済み確認は呼び出し側の isUntouched / isMerged 判定で済んでいるため -D で良い
async function removeBranch(name: string, opts: Opts): Promise<BranchActionResult> {
  const { code, stderr } = await git(["branch", "-D", name], opts);

  // "not found" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("not found")) {
    return { action: "removed", name };
  }

  return { action: "failed", message: `exit ${String(code)}: ${stderr.trim()}`, name };
}
