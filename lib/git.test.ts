import { expect, test } from "vitest";
import { gitExitOk, gitText } from "./git";
import { makeRepo } from "./test-helpers";

// gitText は trim した stdout
test("gitText returns trimmed stdout", async () => {
  await using repo = await makeRepo();

  expect(await gitText(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo.dir })).toBe("main");
});

// gitExitOk は失敗で false（throw しない）
test("gitExitOk reports false on a failing command instead of throwing", async () => {
  await using repo = await makeRepo();

  expect(await gitExitOk(["rev-parse", "does-not-exist"], { cwd: repo.dir })).toBe(false);
});
