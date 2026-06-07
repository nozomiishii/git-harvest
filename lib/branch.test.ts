import { expect, test } from "vitest";
import { type BranchInfo, cleanupBranches, decideBranch } from "./branch";
import { defaultFlags } from "./flags";
import { makeRepo } from "./test-helpers";
import { cleanupWorktrees } from "./worktree";

function br(over: Partial<BranchInfo>): BranchInfo {
  return { classification: "other", invariantReason: undefined, name: "feature", ...over };
}

// invariant branch は理由をそのまま reason に返す
test("decideBranch keeps an invariant branch and surfaces its reason", () => {
  const result = decideBranch(br({ invariantReason: "current HEAD" }), defaultFlags());

  if (result.remove) {
    throw new Error("expected kept");
  }

  expect(result.reason).toBe("current HEAD");
});

// merged は in-base として default 削除
test("decideBranch removes a merged branch as in-base by default", () => {
  expect(decideBranch(br({ classification: "merged" }), defaultFlags()).remove).toBe(true);
});

// untouched も in-base として default 削除
test("decideBranch removes an untouched branch as in-base by default", () => {
  expect(decideBranch(br({ classification: "untouched" }), defaultFlags()).remove).toBe(true);
});

// committed（other）な branch は default で保護
test("decideBranch keeps a committed branch by default", () => {
  expect(decideBranch(br({ classification: "other" }), defaultFlags()).remove).toBe(false);
});

// committed 閾値で committed な branch を削除
test("decideBranch removes a committed branch at the committed threshold", () => {
  const flags = {
    ...defaultFlags(),
    thresholds: { ...defaultFlags().thresholds, branch: "committed" as const },
  };

  expect(decideBranch(br({ classification: "other" }), flags).remove).toBe(true);
});

// base に取り込まれた branch は default で削除
test("cleanupBranches removes an in-base branch by default", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commitFile("x.txt", "x", "done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");

  const result = await cleanupBranches("main", defaultFlags(), [], { cwd: repo.dir });

  expect(result.results.some((r) => r.action === "removed" && r.name === "done")).toBe(true);
});

// 生存 worktree が checkout 中の branch は invariant 保護（survivingPaths 経由）
test("cleanupBranches keeps a branch checked out in a surviving worktree", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commitFile("y.txt", "y", "wip work");
  await repo.git("switch", "main");
  const wtPath = `${repo.dir}-wip`;
  await repo.git("worktree", "add", wtPath, "wip");
  const wt = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });
  const flags = {
    ...defaultFlags(),
    thresholds: { ...defaultFlags().thresholds, branch: "committed" as const },
  };

  const result = await cleanupBranches("main", flags, wt.survivingPaths, { cwd: repo.dir });

  expect(result.results.some((r) => r.action === "kept" && r.name === "wip")).toBe(true);
});
