import type { Classification } from "./types";
import { git, gitExitOk, gitText } from "./git";

type Opts = { cwd?: string };

// base と branch は同型 string なのでオブジェクトで受けて取り違えを防ぐ
type Refs = { base: string; branch: string };

// このファイルは「ブランチが base にどう取り込まれているか」を boolean 2つで答える。
//   isUntouched: 作業なし（base の本流上、独自コミット無し）       … 旧 first-parent
//   isMerged:    通常マージ / squash / rebase のいずれかで取り込み済み
//     - isAncestorMerged: 通常マージ / fast-forward
//     - isSquashMerged:   squash マージ（GitHub のデフォルト）
//     - isRebaseMerged:   rebase / cherry-pick
// 「merged でも untouched でもない」状態に名前は付けない（呼び出し側で committed と判断する）。

// worktree.ts / branch.ts が isUntouched / isMerged へ移るまで残す（後続タスクで削除）。
// fail-closed の極性: 段1〜3 は失敗時 false で次段へ落ち、最終段 isRebaseMerged も失敗時 false
// （= other）で keep 側に倒す
export async function classifyBranch(refs: Refs, opts: Opts = {}): Promise<Classification> {
  // 段1: base の first-parent 履歴上にあれば独自コミット無し
  if (await isUntouched(refs, opts)) {
    return "untouched";
  }

  // 段2: 通常マージ（fast-forward 含む）
  if (await isAncestorMerged(refs, opts)) {
    return "merged";
  }

  // 段3: squash マージ検出。段4と相補（multi-commit の squash / rebase で互いに補う）ため統合不可
  if (await isSquashMerged(refs, opts)) {
    return "merged";
  }

  // 段4: rebase / cherry-pick マージ検出
  return (await isRebaseMerged(refs, opts)) ? "merged" : "other";
}

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

// first-parent = マージで合流してきた側の枝を無視した、base の本流だけの commit 一覧。
// branch の先頭 commit が本流上にある = このブランチではまだ独自の作業をしていない
export async function isUntouched({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  // rev-parse はブランチ名を commit ID に解決する。
  // 壊れた ref は gitText がここで throw → 呼び出し側の fail-soft で failed になる（git() に変えない）
  const head = await gitText(["rev-parse", branch], opts);
  const firstParentResult = await git(["rev-list", "--first-parent", base], opts);
  const firstParent = firstParentResult.stdout;

  return firstParent.split("\n").includes(head);
}

// merge-base --is-ancestor A B = 「A は B の歴史に含まれるか」。
// branch が base の歴史に含まれる = branch の commit はすべて base に到達済み = マージ済み
async function isAncestorMerged({ base, branch }: Refs, opts: Opts): Promise<boolean> {
  return gitExitOk(["merge-base", "--is-ancestor", branch, base], opts);
}

// branch 側の commit がすべて base に取り込み済みなら true。
// --cherry-pick は commit ID でなく変更内容で照合するため、rebase / cherry-pick で
// ID が変わって base に入った commit も「取り込み済み」と判定できる
async function isRebaseMerged({ base, branch }: Refs, opts: Opts): Promise<boolean> {
  const result = await git(
    ["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`],
    opts,
  );

  if (result.code !== 0) {
    return false; // 判定不能は「マージ済みでない」に倒す（従来の keep 側と同結果）
  }

  return result.stdout.trim() === "";
}

// squash マージ = ブランチの全 commit を 1 つに潰して base に積む方式。元の commit は base の
// 履歴に現れないため、同じ「潰した 1 commit」を手元で仮に作り（commit-tree）、その内容が base に
// 入っているかを cherry で照合する。判定不能（merge-base 無し等）は false = 次の段へ
async function isSquashMerged({ base, branch }: Refs, opts: Opts): Promise<boolean> {
  // merge-base = base と branch が分岐した地点の commit
  const mergeBaseResult = await git(["merge-base", base, branch], opts);
  const mergeBase = mergeBaseResult.stdout.trim();

  if (!mergeBase) {
    return false;
  }

  // commit-tree は dangling object を作るだけなので dry-run でも安全
  const squashResult = await git(
    ["commit-tree", `${branch}^{tree}`, "-p", mergeBase, "-m", "_"],
    opts,
  );
  const squash = squashResult.stdout.trim();

  if (!squash) {
    return false;
  }
  // git cherry = 各 commit の変更内容が base に取り込み済みなら "-"、未取り込みなら "+" を付けて列挙
  const cherryResult = await git(["cherry", base, squash], opts);
  const cherry = cherryResult.stdout;

  if (!cherry.trim()) {
    return false;
  }
  const added = cherry.split("\n").filter((line) => line.startsWith("+"));

  // + 行（base に未取り込みの commit）がゼロなら squash マージ済み
  return added.length === 0;
}
