import { expect, test } from "vitest";
import { classifyBranch } from "./merge-detect";
import { commitFile, makeOriginRepo, tgit } from "./test-helpers";

// 独自コミットが無く base の first-parent 線上にあれば untouched
test("classifyBranch classifies a branch with no unique commits as untouched", async () => {
  using r = makeOriginRepo();
  tgit(r.path, "branch feature main");

  expect(await classifyBranch("main", "feature", { cwd: r.path })).toBe("untouched");
});

// merge commit で base に取り込まれた branch は merged（ancestor フォールバック）
test("classifyBranch classifies a merge-committed branch as merged", async () => {
  using r = makeOriginRepo();
  tgit(r.path, "checkout -b feature");
  commitFile(r.path, "feature.txt", "work");
  tgit(r.path, "checkout main");
  tgit(r.path, 'merge --no-ff feature -m "merge feature"');

  expect(await classifyBranch("main", "feature", { cwd: r.path })).toBe("merged");
});

// squash 相当（同内容を base に別コミットで取り込み）も merged
test("classifyBranch classifies a squash-merged branch as merged", async () => {
  using r = makeOriginRepo();
  tgit(r.path, "checkout -b squashed");
  commitFile(r.path, "squash.txt", "squash work");
  tgit(r.path, "checkout main");
  // squash 相当: branch の変更を1コミットに畳んで base へ
  tgit(r.path, "merge --squash squashed");
  tgit(r.path, 'commit -m "squashed feature"');

  expect(await classifyBranch("main", "squashed", { cwd: r.path })).toBe("merged");
});

// base に未取り込みの独自コミットを持つ branch は other
test("classifyBranch classifies an unmerged branch as other", async () => {
  using r = makeOriginRepo();
  tgit(r.path, "checkout -b wip");
  commitFile(r.path, "wip.txt", "in progress");
  tgit(r.path, "checkout main");

  expect(await classifyBranch("main", "wip", { cwd: r.path })).toBe("other");
});

// 存在しない branch は分類不能で other
test("classifyBranch classifies a nonexistent branch as other", async () => {
  using r = makeOriginRepo();

  expect(await classifyBranch("main", "no-such-branch", { cwd: r.path })).toBe("other");
});
