import { isAncestorMerged } from "./ancestor";
import { isRebaseMerged } from "./rebase";
import { isSquashMerged } from "./squash";

interface Opts {
  cwd?: string;
}
interface Refs {
  base: string;
  branch: string;
}

// 「branch が base にどう取り込まれているか」を 2 つの判定で答えるモジュール。
//   isUntouched: 作業そのものが無い（base 本流に並んでいるだけ）
//   isMerged:    通常マージ / squash / rebase のいずれかで取り込み済み
// どちらでもなければ committed（base に未取り込みの独自コミットあり）と呼び出し側が判断する。

/**
 * 通常マージ、squash、rebase の順で取り込み済みか調べる。
 * 各方式で判定できなければ次へ進む。
 *
 * @param refs - 基準と対象のブランチ参照。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns いずれかの方式で取り込み済みなら true。
 */
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
