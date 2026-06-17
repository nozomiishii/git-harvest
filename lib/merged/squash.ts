import { git } from "../git/exec";

type Opts = { cwd?: string };
type Refs = { base: string; branch: string };

// squash マージ = branch の全 commit を 1 つに潰して base に積む方式（GitHub のデフォルト）。
// 元の commit は base の履歴に直接は現れないので、ID では見つからない。
// 代わりに、「branch を 1 つに潰したら何になるか」を手元で仮に作り、
// それが base に取り込まれているかを変更内容で照合する。
// どこかで作れなかった / 比較できなかった場合は false を返し、次の検出方式に任せる
export async function isSquashMerged({ base, branch }: Refs, opts: Opts = {}): Promise<boolean> {
  // base と branch が分岐した地点の commit を取る
  const mergeBaseResult = await git(["merge-base", base, branch], opts);
  const mergeBase = mergeBaseResult.stdout.trim();

  if (!mergeBase) {
    return false;
  }

  // 「分岐点を親に持ち、branch の最新 tree を中身に持つ」仮の commit を作る。
  // どのブランチからも参照されない孤立した commit なので、リポジトリに副作用は無い
  const squashResult = await git(
    ["commit-tree", `${branch}^{tree}`, "-p", mergeBase, "-m", "_"],
    opts,
  );
  const squash = squashResult.stdout.trim();

  if (!squash) {
    return false;
  }
  // git cherry は、左 (base) と右 (squash) の commit を変更内容で照合し、
  // 右にしかない変更を + 、すでに左に入っている変更を - で列挙する
  const cherryResult = await git(["cherry", base, squash], opts);
  const cherry = cherryResult.stdout;

  if (!cherry.trim()) {
    return false;
  }
  const added = cherry.split("\n").filter((line) => line.startsWith("+"));

  // + 行が無い = base に未取り込みの変更が無い = squash 済み
  return added.length === 0;
}
