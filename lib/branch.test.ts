import { rmSync } from "node:fs";
import { expect, test } from "vitest";
import { type BranchInfo, cleanupBranches, decideBranch } from "./branch";
import { defaultFlags } from "./flags";
import { assertKept, makeRepo } from "./test-helpers";
import { cleanupWorktrees } from "./worktree";

function br(over: Partial<BranchInfo>): BranchInfo {
  return { classification: "other", invariantReason: undefined, name: "feature", ...over };
}

// invariant branch は理由をそのまま reason に返す
test("decideBranch keeps an invariant branch and surfaces its reason", () => {
  const result = decideBranch(br({ invariantReason: "current HEAD" }), defaultFlags());

  assertKept(result);

  expect(result.reason).toBe("current HEAD");
});

// untouched は in-base として default 削除（merged も decideBranch では同一分岐）
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

  const result = await cleanupBranches("main", defaultFlags(), new Set<string>(), {
    cwd: repo.dir,
  });

  expect(result.results.some((r) => r.action === "removed" && r.name === "done")).toBe(true);
});

// branch と同名の tag があっても素の branch 名で列挙・削除できる（refname:short の曖昧性解消対策）
test("cleanupBranches handles a branch shadowed by a same-named tag", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "feature");
  await repo.commitFile("t.txt", "t", "feature work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "feature", "-m", "merge feature");
  await repo.git("tag", "feature");

  const result = await cleanupBranches("main", defaultFlags(), new Set<string>(), {
    cwd: repo.dir,
  });

  expect(result.results.some((r) => r.action === "removed" && r.name === "feature")).toBe(true);
  await expect(repo.git("rev-parse", "--verify", "refs/heads/feature")).rejects.toThrow(/fatal/);
});

// detached HEAD のプレースホルダ行 "(HEAD detached at ...)" はブランチとして扱わない
test("cleanupBranches ignores the detached HEAD placeholder line", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "--detach");

  const result = await cleanupBranches("main", defaultFlags(), new Set<string>(), {
    cwd: repo.dir,
  });

  expect(result.failures).toBe(0);
});

// main worktree に checkout 中の branch も invariant 保護（survivingBranches に main の branch を含む）
test("cleanupBranches keeps a branch checked out in the main worktree", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commitFile("z.txt", "z", "done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  await repo.git("switch", "done");
  const wtPath = `${repo.dir}-base`;
  await repo.git("worktree", "add", wtPath, "main");

  try {
    const wt = await cleanupWorktrees("main", defaultFlags(), { cwd: wtPath });

    const result = await cleanupBranches("main", defaultFlags(), wt.survivingBranches, {
      cwd: wtPath,
    });

    expect(
      result.results.some(
        (r) => r.action === "kept" && r.name === "done" && r.reason === "checked out",
      ),
    ).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
  }
});

// リモートで削除済みの追跡ブランチを実行後の fetch --prune で整理（旧 bash の挙動）
test("cleanupBranches prunes stale remote-tracking branches", async () => {
  await using repo = await makeRepo();
  await repo.git("update-ref", "refs/remotes/origin/gone", "HEAD");

  await cleanupBranches("main", defaultFlags(), new Set<string>(), { cwd: repo.dir });

  await expect(repo.git("rev-parse", "--verify", "refs/remotes/origin/gone")).rejects.toThrow(
    /fatal/,
  );
});

// 生存 worktree が checkout 中の branch は invariant 保護（survivingBranches 経由）
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

  const result = await cleanupBranches("main", flags, wt.survivingBranches, { cwd: repo.dir });

  expect(result.results.some((r) => r.action === "kept" && r.name === "wip")).toBe(true);
});
