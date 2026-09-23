import { git, gitText } from "../git/exec";

interface Opts {
  cwd?: string;
}
interface Refs {
  base: string;
  branch: string;
}

/**
 * ブランチの先頭が base の first-parent 履歴上にあるか調べる。
 * マージで合流した側を辿らず、base 本流の commit と比較する。
 *
 * @param root0 - 基準と対象のブランチ参照。
 *
 * @param root0.base - 基準ブランチの参照名。
 *
 * @param root0.branch - 判定するブランチの参照名。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns 独自コミットがなければ true。
 */
export async function isUntouched({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  // ブランチ名から commit ID へ変換。
  // 壊れた ref のときは gitText が throw して、cleanup 側で failed として記録される。
  // ここで git()（throw しない版）に変えると壊れた ref が黙って untouched=false 扱いになる
  const head = await gitText(["rev-parse", branch], opts);
  const firstParentResult = await git(["rev-list", "--first-parent", base], opts);
  const firstParent = firstParentResult.stdout;

  return firstParent.split("\n").includes(head);
}
