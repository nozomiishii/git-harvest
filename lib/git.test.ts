import { expect, test } from "vitest";
import { git } from "./git";
import { makeRepo } from "./test-helpers";

// git のエラーメッセージは stderr に出る。救済パス（"not found" 等の照合）が依存する契約として固定
test("git surfaces stderr from a failing command", async () => {
  await using repo = await makeRepo();

  const result = await git(["branch", "-D", "nope"], { cwd: repo.dir });

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("not found");
});
