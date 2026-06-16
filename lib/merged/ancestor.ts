import { gitExitOk } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// merge-base --is-ancestor A B = 「A は B の歴史に含まれるか」。
// branch が base の歴史に含まれる = branch の commit はすべて base に到達済み = マージ済み
export async function isAncestorMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  return gitExitOk(["merge-base", "--is-ancestor", branch, base], opts);
}
