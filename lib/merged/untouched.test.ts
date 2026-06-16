import { expect, test } from "vitest";
import { makeRepo } from "../testing/repo";
import { isUntouched } from "./untouched";

// 独自コミット無しの branch は isUntouched
test("isUntouched is true for a branch with no unique commits", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "fresh");

  expect(await isUntouched({ base: "main", branch: "fresh" }, { cwd: repo.dir })).toBe(true);
});
