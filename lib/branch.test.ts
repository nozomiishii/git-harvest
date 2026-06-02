import { execSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "vitest";
import type { Flags } from "./types";
import { branchStage, cleanupBranches, shouldDeleteBranch } from "./branch";
import { assertDefined, commitFile, makeOriginRepo, tgit } from "./test-helpers";

// branch 短縮名一覧を取得する（%(...) は sh が誤解釈するため git branch + 整形で取る）
function branches(cwd: string): string[] {
  return execSync("git branch", { cwd, encoding: "utf8" })
    .split("\n")
    .map((b) => b.replace(/^[*+ ]+/, "").trim())
    .filter(Boolean);
}

// default flags（branch 閾値 merged）
function defaultFlags(overrides: Partial<Flags> = {}): Flags {
  return {
    branch: "merged",
    claudeWorktree: "merged",
    claudeWorktreeDetached: false,
    claudeWorktreeUntouched: false,
    dryRun: false,
    worktree: "merged",
    worktreeDetached: false,
    worktreeUntouched: false,
    ...overrides,
  };
}

// worktree path 一覧を取得する（surviving 集合に使う）
function worktreePaths(cwd: string): string[] {
  return execSync("git worktree list --porcelain", { cwd, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.replace("worktree ", ""));
}

// merged / untouched は base にある = merged に畳む
test("branchStage folds merged and untouched into merged", () => {
  expect(branchStage("merged")).toBe("merged");
  expect(branchStage("untouched")).toBe("merged");
});

// other は committed
test("branchStage maps other to committed", () => {
  expect(branchStage("other")).toBe("committed");
});

// base branch は消えない
test("shouldDeleteBranch never deletes the base branch", () => {
  expect(
    shouldDeleteBranch(
      {
        checkedOutInSurviving: false,
        classification: "merged",
        isBase: true,
        isCurrentHead: false,
        name: "main",
      },
      defaultFlags(),
    ),
  ).toBe(false);
});

// 現在 HEAD は消えない
test("shouldDeleteBranch never deletes the current HEAD", () => {
  expect(
    shouldDeleteBranch(
      {
        checkedOutInSurviving: false,
        classification: "merged",
        isBase: false,
        isCurrentHead: true,
        name: "cur",
      },
      defaultFlags(),
    ),
  ).toBe(false);
});

// 生存 worktree が checkout 中の branch は消えない
test("shouldDeleteBranch never deletes a branch checked out in a surviving worktree", () => {
  expect(
    shouldDeleteBranch(
      {
        checkedOutInSurviving: true,
        classification: "merged",
        isBase: false,
        isCurrentHead: false,
        name: "wt",
      },
      defaultFlags(),
    ),
  ).toBe(false);
});

// merged は default で削除、other は default で残り branch=committed で削除
test("shouldDeleteBranch deletes merged by default and other only at committed threshold", () => {
  const merged = {
    checkedOutInSurviving: false,
    classification: "merged" as const,
    isBase: false,
    isCurrentHead: false,
    name: "m",
  };
  const other = {
    checkedOutInSurviving: false,
    classification: "other" as const,
    isBase: false,
    isCurrentHead: false,
    name: "o",
  };

  expect(shouldDeleteBranch(merged, defaultFlags())).toBe(true);
  expect(shouldDeleteBranch(other, defaultFlags())).toBe(false);
  expect(shouldDeleteBranch(other, defaultFlags({ branch: "committed" }))).toBe(true);
});

// in-base（merged）の branch は default で削除する
test("cleanupBranches deletes a merged branch by default", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "checkout -b br-merged");
  commitFile(repo, "merged.txt", "work");
  tgit(repo, "checkout main");
  tgit(repo, "merge --squash br-merged");
  tgit(repo, 'commit -m "squash merged"');
  tgit(repo, "push");

  const result = await cleanupBranches("main", defaultFlags(), worktreePaths(repo), repo);

  expect(result.failures).toBe(0);
  expect(result.results.some((r) => r.name === "br-merged" && r.action === "removed")).toBe(true);
  expect(branches(repo)).not.toContain("br-merged");
});

// in-base（untouched = 独自コミットなし）の branch も default で削除する
test("cleanupBranches deletes an untouched branch by default", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "branch br-untouched main");
  const result = await cleanupBranches("main", defaultFlags(), worktreePaths(repo), repo);

  expect(result.results.some((r) => r.name === "br-untouched" && r.action === "removed")).toBe(
    true,
  );
  expect(branches(repo)).not.toContain("br-untouched");
});

// other branch は default で残り、branch=committed で削除する
test("cleanupBranches keeps an other branch by default and deletes it at committed threshold", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "checkout -b br-other");
  commitFile(repo, "other.txt", "work");
  tgit(repo, "checkout main");

  const kept = await cleanupBranches("main", defaultFlags(), worktreePaths(repo), repo);
  const keptEntry = assertDefined(kept.results.find((r) => r.name === "br-other"));

  expect(keptEntry.action).toBe("kept");
  expect(branches(repo)).toContain("br-other");

  const removed = await cleanupBranches(
    "main",
    defaultFlags({ branch: "committed" }),
    worktreePaths(repo),
    repo,
  );

  expect(removed.results.some((r) => r.name === "br-other" && r.action === "removed")).toBe(true);
  expect(branches(repo)).not.toContain("br-other");
});

// 生存 worktree が checkout 中の merged branch は保護される
test("cleanupBranches keeps a merged branch checked out in a surviving worktree", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "checkout -b br-co");
  commitFile(repo, "co.txt", "work");
  tgit(repo, "checkout main");
  tgit(repo, "merge --squash br-co");
  tgit(repo, 'commit -m "squash co"');
  tgit(repo, "push");

  // worktree に checkout して生存集合に含める
  const dir = path.join(repo, "..", "br-co-dir");
  tgit(repo, `worktree add ${dir} br-co`);

  const surviving = worktreePaths(repo); // 当該 worktree を含む
  const result = await cleanupBranches("main", defaultFlags(), surviving, repo);
  const entry = assertDefined(result.results.find((r) => r.name === "br-co"));

  expect(entry.action).toBe("kept");
  expect(entry.action === "kept" && entry.reason).toBe("currently checked out");
  expect(branches(repo)).toContain("br-co");
});

// 生存集合から外れた worktree の branch は解放され、merged なら削除される
test("cleanupBranches deletes a merged branch when its worktree is not in the surviving set", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "checkout -b br-released");
  commitFile(repo, "released.txt", "work");
  tgit(repo, "checkout main");
  tgit(repo, "merge --squash br-released");
  tgit(repo, 'commit -m "squash released"');
  tgit(repo, "push");

  const dir = path.join(repo, "..", "br-released-dir");
  tgit(repo, `worktree add ${dir} br-released`);
  // worktree を実削除して branch を解放する（surviving からも外れる）
  tgit(repo, `worktree remove ${dir}`);

  const result = await cleanupBranches("main", defaultFlags(), worktreePaths(repo), repo);

  expect(result.results.some((r) => r.name === "br-released" && r.action === "removed")).toBe(true);
  expect(branches(repo)).not.toContain("br-released");
});

// 現在 HEAD の branch は merged でも消えない
test("cleanupBranches keeps the current HEAD branch even when merged", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "checkout -b br-head");
  commitFile(repo, "head.txt", "work");
  tgit(repo, "checkout main");
  tgit(repo, "merge --squash br-head");
  tgit(repo, 'commit -m "squash head"');
  tgit(repo, "push");
  // merged branch に戻って HEAD にする
  tgit(repo, "checkout br-head");

  const result = await cleanupBranches("main", defaultFlags(), worktreePaths(repo), repo);
  const entry = assertDefined(result.results.find((r) => r.name === "br-head"));

  expect(entry.action).toBe("kept");
  expect(branches(repo)).toContain("br-head");
});

// dryRun では削除せず would-remove を返す
test("cleanupBranches dry-run reports would-remove without deleting", async () => {
  using r = makeOriginRepo();
  const repo = r.path;

  tgit(repo, "checkout -b br-dry");
  commitFile(repo, "dry.txt", "work");
  tgit(repo, "checkout main");
  tgit(repo, "merge --squash br-dry");
  tgit(repo, 'commit -m "squash dry"');
  tgit(repo, "push");

  const result = await cleanupBranches(
    "main",
    defaultFlags({ dryRun: true }),
    worktreePaths(repo),
    repo,
  );

  expect(result.results.some((r) => r.name === "br-dry" && r.action === "would-remove")).toBe(true);
  expect(branches(repo)).toContain("br-dry");
});
