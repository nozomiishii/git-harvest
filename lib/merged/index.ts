import { isAncestorMerged } from "./ancestor";
import { isRebaseMerged } from "./rebase";
import { isSquashMerged } from "./squash";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// 「branch が base にどう取り込まれているか」を 2 つの判定で答えるモジュール。
//   isUntouched: 作業そのものが無い（base 本流に並んでいるだけ）
//   isMerged:    通常マージ / squash / rebase のいずれかで取り込み済み
// どちらでもなければ committed（base に未取り込みの独自コミットあり）と呼び出し側が判断する。

// マージ済みかを 3 つの方式で順に試し、1 つでも当たれば取り込み済み。
// それぞれの方式は「git コマンドが失敗 = この方式では判定できない」として false を返し、
// 次の方式に委ねる。新しい方式を足すときも、このフォールバック規約を守ること
export async function isMerged(refs: Refs, opts: Opts = {}): Promise<boolean> {
  if (await isAncestorMerged(refs, opts)) {
    return true;
  }

  if (await isSquashMerged(refs, opts)) {
    return true;
  }

  return isRebaseMerged(refs, opts);
}

export { isUntouched } from "./untouched";
