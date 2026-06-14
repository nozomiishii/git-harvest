import { expect, test } from "vitest";
import { classifyBranch } from "./merge-detect";
import { makeRepo } from "./test-helpers";

// ancestor として入っていれば merged
test("classifyBranch returns merged for a branch merged into base", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "feature");
  await repo.commit("work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "feature", "-m", "merge feature");

  expect(await classifyBranch({ base: "main", branch: "feature" }, { cwd: repo.dir })).toBe(
    "merged",
  );
});

// 独自コミット無しは untouched
test("classifyBranch returns untouched for a branch with no unique commits", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "fresh");

  expect(await classifyBranch({ base: "main", branch: "fresh" }, { cwd: repo.dir })).toBe(
    "untouched",
  );
});

// 未取り込みの独自コミットは other
test("classifyBranch returns other for an unmerged branch with unique commits", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commit("unmerged work");

  expect(await classifyBranch({ base: "main", branch: "wip" }, { cwd: repo.dir })).toBe("other");
});

// squash merge: コミットは残らないが tree が base に取り込まれていれば merged（段3）
test("classifyBranch returns merged for a squash-merged branch", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "squashed");
  await repo.commitFile("a.txt", "hello", "add a");
  await repo.git("switch", "main");
  await repo.git("merge", "--squash", "squashed");
  await repo.git("commit", "-m", "squash squashed");

  expect(await classifyBranch({ base: "main", branch: "squashed" }, { cwd: repo.dir })).toBe(
    "merged",
  );
});

// git が失敗して判定不能なら merged に倒さず other（keep）に倒す
test("classifyBranch fails closed when the base cannot be resolved", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commit("unmerged work");

  expect(await classifyBranch({ base: "missing-base", branch: "wip" }, { cwd: repo.dir })).toBe(
    "other",
  );
});
