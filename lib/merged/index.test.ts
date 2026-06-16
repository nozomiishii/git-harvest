import { expect, test } from "vitest";
import { makeRepo } from "../testing/repo";
import { isMerged } from "./index";

// 通常マージ（--no-ff）で取り込まれた branch は isMerged
test("isMerged is true for an ancestor-merged branch", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "feature");
  await repo.commit("work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "feature", "-m", "merge feature");

  expect(await isMerged({ base: "main", branch: "feature" }, { cwd: repo.dir })).toBe(true);
});

// 未取り込みの独自コミットがある branch は isMerged でない
test("isMerged is false for an unmerged branch with unique commits", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commit("unmerged work");

  expect(await isMerged({ base: "main", branch: "wip" }, { cwd: repo.dir })).toBe(false);
});

// squash マージ済み（コミットは残らないが tree が base にある）も isMerged
test("isMerged is true for a squash-merged branch", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "squashed");
  await repo.commitFile("a.txt", "hello", "add a");
  await repo.git("switch", "main");
  await repo.git("merge", "--squash", "squashed");
  await repo.git("commit", "-m", "squash squashed");

  expect(await isMerged({ base: "main", branch: "squashed" }, { cwd: repo.dir })).toBe(true);
});

// cherry-pick で SHA は変わるが内容が base にあれば isMerged（rebase 系の検出）
test("isMerged is true for a branch cherry-picked into base with a new SHA", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "feature");
  await repo.commitFile("a.txt", "hello", "add a");
  await repo.git("switch", "main");
  await repo.git("cherry-pick", "feature");

  expect(await isMerged({ base: "main", branch: "feature" }, { cwd: repo.dir })).toBe(true);
});

// base 解決不能で判定できないときは isMerged を false（keep 側）に倒す
test("isMerged is false when the base cannot be resolved", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commit("unmerged work");

  expect(await isMerged({ base: "missing-base", branch: "wip" }, { cwd: repo.dir })).toBe(false);
});
