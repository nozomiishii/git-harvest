import { git } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// branch 側の commit がすべて base に取り込み済みなら true。
// --cherry-pick は commit ID でなく変更内容で照合するため、rebase / cherry-pick で
// ID が変わって base に入った commit も「取り込み済み」と判定できる
export async function isRebaseMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  const result = await git(
    ["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`],
    opts,
  );

  if (result.code !== 0) {
    return false; // 判定不能は「マージ済みでない」に倒す（従来の keep 側と同結果）
  }

  return result.stdout.trim() === "";
}
