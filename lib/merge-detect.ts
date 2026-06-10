import type { Classification } from "./types";
import { git, gitExitOk, gitText } from "./git";

type Opts = { cwd?: string };

// base と branch は同型 string なのでオブジェクトで受けて取り違えを防ぐ
type Refs = { base: string; branch: string };

export async function classifyBranch(refs: Refs, opts: Opts = {}): Promise<Classification> {
  // 段1: base の first-parent 履歴上にあれば独自コミット無し
  if (await isInFirstParentHistory(refs, opts)) {
    return "untouched";
  }

  // 段2: 通常マージ（fast-forward 含む）
  if (await isAncestorOfBase(refs, opts)) {
    return "merged";
  }

  // 段3: squash マージ検出。段4と相補（multi-commit の squash / rebase で互いに補う）ため統合不可
  if (await isSquashMerged(refs, opts)) {
    return "merged";
  }

  // 段4: rebase / cherry-pick マージ検出
  const unique = await hasUniqueCommits(refs, opts);

  return unique ? "other" : "merged";
}

async function hasUniqueCommits({ base, branch }: Refs, opts: Opts): Promise<boolean> {
  const uniqueResult = await git(
    ["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`],
    opts,
  );

  // git 失敗時は stdout が空でも merged に倒さず keep 側に倒す（fail-closed）
  if (uniqueResult.code !== 0) {
    return true;
  }

  return uniqueResult.stdout.trim() !== "";
}

async function isAncestorOfBase({ base, branch }: Refs, opts: Opts): Promise<boolean> {
  return gitExitOk(["merge-base", "--is-ancestor", branch, base], opts);
}

async function isInFirstParentHistory({ base, branch }: Refs, opts: Opts): Promise<boolean> {
  // 壊れた ref は gitText がここで throw → 呼び出し側の fail-soft で failed になる（git() に変えない）
  const head = await gitText(["rev-parse", branch], opts);
  const firstParentResult = await git(["rev-list", "--first-parent", base], opts);
  const firstParent = firstParentResult.stdout;

  return firstParent.split("\n").includes(head);
}

// 仮想 squash commit を作って cherry で照合。判定不能（merge-base 無し等）は false = 次の段へ
async function isSquashMerged({ base, branch }: Refs, opts: Opts): Promise<boolean> {
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
  const cherryResult = await git(["cherry", base, squash], opts);
  const cherry = cherryResult.stdout;

  if (!cherry.trim()) {
    return false;
  }
  const added = cherry.split("\n").filter((line) => line.startsWith("+"));

  // + 行（base に未取り込みの commit）がゼロなら squash マージ済み
  return added.length === 0;
}
