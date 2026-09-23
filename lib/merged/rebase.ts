import { git } from "../git/exec";

interface Opts {
  cwd?: string;
}
interface Refs {
  base: string;
  branch: string;
}

/**
 * 変更内容で rebase や cherry-pick による取り込みを調べる。
 * commit ID が変わるため git log --cherry-pick で差分を照合する。
 *
 * @param root0 - 基準と対象のブランチ参照。
 *
 * @param root0.base - 基準ブランチの参照名。
 *
 * @param root0.branch - 判定するブランチの参照名。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 未取り込みの変更がなければ true。
 */
export async function isRebaseMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  const result = await git(
    ["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`],
    opts,
  );

  if (result.code !== 0) {
    // 判定不能なときは「取り込まれていない（=消さない）」側に倒す。安全側
    return false;
  }

  // 出力が空 = branch 側に未取り込みの commit が無い = 取り込み済み
  return result.stdout.trim() === "";
}
