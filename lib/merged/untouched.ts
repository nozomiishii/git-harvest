import { git, gitText } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// branch の先頭 commit が base の本流に並んでいれば untouched（このブランチで作業していない）。
// 「本流」= マージで合流してきた側を辿らず、base 自身が積み重ねてきた commit 列。
// git rev-list --first-parent がそれを上から並べた一覧を返す
export async function isUntouched({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  // ブランチ名から commit ID へ変換。
  // 壊れた ref のときは gitText が throw して、cleanup 側で failed として記録される。
  // ここで git()（throw しない版）に変えると壊れた ref が黙って untouched=false 扱いになる
  const head = await gitText(["rev-parse", branch], opts);
  const firstParentResult = await git(["rev-list", "--first-parent", base], opts);
  const firstParent = firstParentResult.stdout;

  return firstParent.split("\n").includes(head);
}
