import { git } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// rebase / cherry-pick で base に取り込まれた branch を検出する。
// この 2 つは元の commit ID を捨てて新しい ID で base に積み直すので、ID 比較では検出できない。
// git log --cherry-pick は ID でなく「変更内容」で照合するので、
// branch 側の commit が中身として base に入っていれば「取り込み済み」と判定できる
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
