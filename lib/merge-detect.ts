import type { Classification } from "./types";
import { git, gitExitOk, gitText } from "./git";

// branch を base に対して分類する: untouched / merged / other。
// samples/git-harvest-default.sh の classify_branch() を忠実移植した 4 段階フォールバック。
//   first-parent 線上一致      -> untouched（独自コミットなし）
//   merge-base --is-ancestor   -> merged（base に含まれる）
//   仮想 squash + git cherry   -> merged（+ 行ゼロ = 内容取り込み済み）
//   log --cherry-pick 空       -> merged（同等 commit が base 側に存在）
//   どれも当たらない            -> other（base に未取り込みの独自コミットあり）
export async function classifyBranch(
  base: string,
  branch: string,
  opts: { cwd?: string | undefined } = {},
): Promise<Classification> {
  const cwd = opts.cwd;

  // HEAD を解決できなければ分類不能。bash 同様 other を返す。
  let head: string;

  try {
    head = await gitText(["rev-parse", branch], { cwd });
  } catch {
    return "other";
  }

  // 1) HEAD が base の first-parent 線上にあれば独自コミットなし = untouched。
  try {
    const firstParent = await gitText(["rev-list", "--first-parent", base], { cwd });

    if (firstParent.split("\n").includes(head)) {
      return "untouched";
    }
  } catch {
    // base を辿れない場合は次のフォールバックへ。
  }

  // 2) branch が base の祖先なら取り込み済み = merged。
  if (await gitExitOk(["merge-base", "--is-ancestor", branch, base], { cwd })) {
    return "merged";
  }

  // 3) 仮想 squash で内容が base に取り込み済みなら merged。
  if (await isSquashMerged(base, branch, cwd)) {
    return "merged";
  }

  // 4) log --cherry-pick --right-only が空 = base 側に同等 commit がある = merged。
  try {
    const { stdout } = await git(
      ["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`],
      { cwd },
    );

    if (stdout.trim() === "") {
      return "merged";
    }
  } catch {
    // 比較できなければ merged とは見なさず other へ落とす。
  }

  return "other";
}

// 仮想 squash 判定: branch の tree を merge-base 上に乗せた commit を作り、
// git cherry で base に対する + 行がゼロなら内容は取り込み済み = merged。
// 途中のどの git が失敗・空でも squash 判定はできないので false（呼び出し側が次の段へ）。
async function isSquashMerged(
  base: string,
  branch: string,
  cwd: string | undefined,
): Promise<boolean> {
  const mergeBase = await tryGitText(["merge-base", base, branch], cwd);

  if (!mergeBase) {
    return false;
  }

  const squash = await tryGitText(
    ["commit-tree", `${branch}^{tree}`, "-p", mergeBase, "-m", "_"],
    cwd,
  );

  if (!squash) {
    return false;
  }

  const cherry = await tryGitText(["cherry", base, squash], cwd);

  if (!cherry) {
    return false;
  }

  const added = cherry.split("\n").filter((line) => line.startsWith("+")).length;

  return added === 0;
}

// gitText を実行し、失敗時は空文字を返す（フォールバック判定用に例外を握りつぶす）。
async function tryGitText(args: string[], cwd: string | undefined): Promise<string> {
  try {
    return await gitText(args, { cwd });
  } catch {
    return "";
  }
}
