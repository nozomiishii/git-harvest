import { expect, test } from "vitest";
import { git } from "./git";
import { makeRepo } from "./test-helpers";

// timeoutMs を超えた git コマンドは kill され非 0 で返る（hook を無限ブロックさせない）
test("git kills a command that exceeds timeoutMs", async () => {
  await using repo = await makeRepo();

  // hash-object --stdin は stdin を待ち続けるので、timeout が効かなければテスト自体がハングする
  const result = await git(["hash-object", "--stdin"], { cwd: repo.dir, timeoutMs: 100 });

  expect(result.code).not.toBe(0);
});

// git のエラーメッセージは stderr に出る。救済パス（"not found" 等の照合）が依存する契約として固定
test("git surfaces stderr from a failing command", async () => {
  await using repo = await makeRepo();

  const result = await git(["branch", "-D", "nope"], { cwd: repo.dir });

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("not found");
});
