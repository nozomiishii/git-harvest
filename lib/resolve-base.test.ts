import { expect, test } from "vitest";
import { resolveBase } from "./resolve-base";
import { makeRepo } from "./test-helpers";

// origin/HEAD から default branch を解決
test("resolveBase resolves the default branch from origin/HEAD", async () => {
  await using repo = await makeRepo();

  expect(await resolveBase({ cwd: repo.dir })).toBe("main");
});

// origin/HEAD 不明なら exit 1 で fail-closed
test("resolveBase fails closed when origin/HEAD cannot be determined", async () => {
  await using repo = await makeRepo();
  await repo.git("remote", "remove", "origin");
  await repo.git("symbolic-ref", "-d", "refs/remotes/origin/HEAD").catch(() => "");
  process.exitCode = 0;

  const base = await resolveBase({ cwd: repo.dir, offline: true });

  expect(base).toBeUndefined();
  expect(process.exitCode).toBe(1);

  process.exitCode = 0; // global を後続テストに残さない
});
