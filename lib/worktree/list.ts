import { gitText } from "../git/exec";
import { realpath } from "../path";

export type WtRecord = { branch: string | undefined; locked: boolean; path: string; realpath: string };

type Opts = { cwd?: string };

export async function listWorktrees(opts: Opts = {}): Promise<WtRecord[]> {
  const out = await gitText(["worktree", "list", "--porcelain"], opts);

  // --porcelain はスクリプト向けの固定書式。エントリごとに空行区切りで、
  // 各エントリは worktree 行（パス）+ 任意の branch / locked 行。先頭は main worktree
  return out
    .split("\n\n")
    .map((block) => parseWorktreeBlock(block))
    .filter((rec) => rec.path !== "");
}

function parseWorktreeBlock(block: string): WtRecord {
  const lines = block.split("\n");
  const path = lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? "";

  return {
    branch: lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length),
    locked: lines.some((l) => l.startsWith("locked")),
    path,
    // realpath はパース時に 1 回だけ付与（macOS の /private symlink 対策。以後の path 比較は realpath で行う）
    realpath: realpath(path),
  };
}
