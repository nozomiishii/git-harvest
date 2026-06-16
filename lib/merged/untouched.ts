import { git, gitText } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// first-parent = マージで合流してきた側の枝を無視した、base の本流だけの commit 一覧。
// branch の先頭 commit が本流上にある = このブランチではまだ独自の作業をしていない
export async function isUntouched({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  // rev-parse はブランチ名を commit ID に解決する。
  // 壊れた ref は gitText がここで throw → 呼び出し側の fail-soft で failed になる（git() に変えない）
  const head = await gitText(["rev-parse", branch], opts);
  const firstParentResult = await git(["rev-list", "--first-parent", base], opts);
  const firstParent = firstParentResult.stdout;

  return firstParent.split("\n").includes(head);
}
