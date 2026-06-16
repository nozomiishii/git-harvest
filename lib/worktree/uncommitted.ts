import { git } from "../git/exec";

// 「未コミットの作業があるか」を git status --porcelain 1 回で調べる。
// porcelain は編集・ステージ・未追跡（.gitignore 対象は除く）をまとめて 1 行ずつ出す。
// -unormal は status.showUntrackedFiles=no 設定を上書きし、未追跡ファイルを必ず数える
// （旧 3 コマンド版と同じく config に依存させない）。出力が空でなければ未コミットの変更あり
export async function hasUncommittedChanges(wt: string): Promise<boolean> {
  const { stdout } = await git(["-C", wt, "status", "--porcelain", "-unormal"]);

  return stdout.trim().length > 0;
}
