import { git } from "../git/exec";

interface Opts {
  cwd?: string;
}
interface Refs {
  base: string;
  branch: string;
}

/**
 * 仮の squash commit と base の変更内容を比較する。
 * 元の commit ID が base にない場合も変更が取り込まれたか判定する。
 * commit の作成や比較に失敗した場合は false を返す。
 *
 * @param root0 - 基準と対象のブランチ参照。
 *
 * @param root0.base - 基準ブランチの参照名。
 *
 * @param root0.branch - 判定するブランチの参照名。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns squash 済みと判定できれば true。
 */
export async function isSquashMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  // base と branch が分岐した地点の commit を取る
  const mergeBaseResult = await git(["merge-base", base, branch], opts);
  const mergeBase = mergeBaseResult.stdout.trim();

  if (!mergeBase) {
    return false;
  }

  // 「分岐点を親に持ち、branch の最新 tree を中身に持つ」仮の commit を作る。
  // 参照は更新しないが、到達不能な commit object は Git の object DB に書き込まれる。
  // `^{tree}` は git の revision 構文で、その commit が指す tree オブジェクトを表す。
  // テンプレートリテラルに入れると `${tree}` の書き損じと区別が付かないので文字列連結で組む
  const squashResult = await git(
    ["commit-tree", branch + "^{tree}", "-p", mergeBase, "-m", "_"],
    opts,
  );
  const squash = squashResult.stdout.trim();

  if (!squash) {
    return false;
  }
  // git cherry は、左 (base) と右 (squash) の commit を変更内容で照合し、
  // 右にしかない変更を + 、すでに左に入っている変更を - で列挙する
  const cherryResult = await git(["cherry", base, squash], opts);
  const cherry = cherryResult.stdout;

  if (!cherry.trim()) {
    return false;
  }
  const added = cherry.split("\n").filter((line) => line.startsWith("+"));

  // + 行が無い = base に未取り込みの変更が無い = squash 済み
  return added.length === 0;
}
