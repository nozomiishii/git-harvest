import { gitText } from "../git/exec";
import { realpath } from "../path";

export interface WtRecord {
  branch: string | undefined;
  locked: boolean;
  path: string;
  realpath: string;
}

interface Opts {
  cwd?: string;
}

/**
 * Git から worktree の一覧を取得する。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns パスとブランチなどを含む worktree の一覧。
 */
export async function listWorktrees(opts: Opts = {}): Promise<WtRecord[]> {
  const out = await gitText(["worktree", "list", "--porcelain"], opts);

  // --porcelain は機械可読の固定書式で出力させるオプション。
  // worktree ごとに 1 ブロックで、ブロック同士は空行で区切られる。
  // 各ブロックは worktree 行（パス）と、任意で branch / locked 行を含む。
  // 一覧の先頭は必ず main worktree
  return out
    .split("\n\n")
    .map((block) => parseWorktreeBlock(block))
    .filter((rec) => rec.path !== "");
}

/**
 * Git の worktree 一件分の出力を読み取る。
 *
 * @param block - worktree 一件分の Git 出力。
 *
 * @returns 読み取った worktree の情報。
 */
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
