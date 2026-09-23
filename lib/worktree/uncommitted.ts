import { git } from "../git/exec";

/**
 * 編集、ステージ済み変更、未追跡ファイルの有無を調べる。
 * porcelain 出力を読み、-unormal で未追跡ファイルを必ず含める。
 * Git コマンドの終了コードは確認しない。
 *
 * @param wt - 状態を調べる worktree のパス。
 *
 * @returns Git の標準出力に変更行があれば true。
 */
export async function hasUncommittedChanges(wt: string): Promise<boolean> {
  const { stdout } = await git(["-C", wt, "status", "--porcelain", "-unormal"]);

  return stdout.trim().length > 0;
}
