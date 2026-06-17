import { gitExitOk } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// 通常マージ / fast-forward を検出する。
// branch の先頭が base の歴史を辿ると現れる位置にあれば、branch の commit は
// すべて base に取り込まれている。git merge-base --is-ancestor がこの判定そのもの
export async function isAncestorMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  return gitExitOk(["merge-base", "--is-ancestor", branch, base], opts);
}
