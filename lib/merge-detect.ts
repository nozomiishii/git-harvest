import type { Classification } from "./types";
import { git, gitExitOk, gitText } from "./git";

type Opts = { cwd?: string };

export async function classifyBranch(
  { base, branch }: { base: string; branch: string },
  opts: Opts = {},
): Promise<Classification> {
  const head = await gitText(["rev-parse", branch], opts);
  const firstParentResult = await git(["rev-list", "--first-parent", base], opts);
  const firstParent = firstParentResult.stdout;

  if (firstParent.split("\n").includes(head)) {
    return "untouched";
  }

  if (await gitExitOk(["merge-base", "--is-ancestor", branch, base], opts)) {
    return "merged";
  }
  const mergeBaseResult = await git(["merge-base", base, branch], opts);
  const mergeBase = mergeBaseResult.stdout.trim();

  if (mergeBase) {
    const squashResult = await git(
      ["commit-tree", `${branch}^{tree}`, "-p", mergeBase, "-m", "_"],
      opts,
    );
    const squash = squashResult.stdout.trim();

    if (squash) {
      const cherryResult = await git(["cherry", base, squash], opts);
      const cherry = cherryResult.stdout;
      const added = cherry.split("\n").filter((l) => l.startsWith("+"));

      if (cherry.trim() && added.length === 0) {
        return "merged";
      }
    }
  }
  const uniqueResult = await git(
    ["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`],
    opts,
  );
  const unique = uniqueResult.stdout;

  // git 失敗時は stdout が空でも merged に倒さず keep 側に倒す（fail-closed）
  if (uniqueResult.code !== 0) {
    return "other";
  }

  return unique.trim() ? "other" : "merged";
}
