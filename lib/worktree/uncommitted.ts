import { git } from "../git/exec";

// 未コミットの変更（編集 / ステージ / 未追跡）が 1 つでもあれば true。
// --porcelain は機械可読の固定書式で、変更を 1 行ずつ並べる（出力が空 = clean）。
// -unormal は「未追跡ファイルは出さない」設定を強制的に打ち消すための保険。
// この設定が効いていると untracked が見えず、誤って files-changed を clean と判定してしまう
export async function hasUncommittedChanges(wt: string): Promise<boolean> {
  const { stdout } = await git(["-C", wt, "status", "--porcelain", "-unormal"]);

  return stdout.trim().length > 0;
}
