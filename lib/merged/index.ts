import { isAncestorMerged } from "./ancestor";
import { isRebaseMerged } from "./rebase";
import { isSquashMerged } from "./squash";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// このモジュールは「ブランチが base にどう取り込まれているか」を boolean 2つで答える。
//   isUntouched: 作業なし（base の本流上、独自コミット無し）       … 旧 first-parent
//   isMerged:    通常マージ / squash / rebase のいずれかで取り込み済み
//     - isAncestorMerged: 通常マージ / fast-forward
//     - isSquashMerged:   squash マージ（GitHub のデフォルト）
//     - isRebaseMerged:   rebase / cherry-pick
// 「merged でも untouched でもない」状態に名前は付けない（呼び出し側で committed と判断する）。

// 3 段を順に試し、どれかが true なら取り込み済み。段ごとに「git 失敗 = この段では判定不能」
// として false で次段へ落ちる（段を増やす時はこの性質を守ること）
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
