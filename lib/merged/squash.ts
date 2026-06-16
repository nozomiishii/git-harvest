import { git } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// squash マージ = ブランチの全 commit を 1 つに潰して base に積む方式。元の commit は base の
// 履歴に現れないため、同じ「潰した 1 commit」を手元で仮に作り（commit-tree）、その内容が base に
// 入っているかを cherry で照合する。判定不能（merge-base 無し等）は false = 次の段へ
export async function isSquashMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
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
