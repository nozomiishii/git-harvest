import { didGitExitOk } from "../git/exec";

interface Opts {
  cwd?: string;
}
interface Refs {
  base: string;
  branch: string;
}

/**
 * merge-base --is-ancestor で通常マージや fast-forward を判定する。
 * ブランチの先頭が base の祖先なら変更は取り込み済み。
 *
 * @param root0 - 基準と対象のブランチ参照。
 *
 * @param root0.base - 基準ブランチの参照名。
 *
 * @param root0.branch - 判定するブランチの参照名。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 祖先なら true。
 */
export async function isAncestorMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  return didGitExitOk(["merge-base", "--is-ancestor", branch, base], opts);
}
