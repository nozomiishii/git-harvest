import { expect, test } from "vitest";
import { makeRepo } from "../testing/repo";
import { resolveBase } from "./index";

// origin/HEAD から default branch を解決
test("resolveBase resolves the default branch from origin/HEAD", async () => {
  await using repo = await makeRepo();

  expect(await resolveBase({ cwd: repo.dir })).toBe("main");
});

// origin/HEAD 不明なら undefined を返す（エラー表示と exit code は cli.ts 側の責務）
test("resolveBase returns undefined when origin/HEAD cannot be determined", async () => {
  await using repo = await makeRepo();
  await repo.git("remote", "remove", "origin");
  await repo.git("symbolic-ref", "-d", "refs/remotes/origin/HEAD").catch(() => "");

  const base = await resolveBase({ cwd: repo.dir, offline: true });

  expect(base).toBeUndefined();
});
