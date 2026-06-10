import { expect, test } from "vitest";
import { atOrSafer } from "./types";

// merged は files-changed 閾値以降（安全側）として削除対象
test("atOrSafer treats merged as deletable when threshold is files-changed", () => {
  expect(atOrSafer("merged", "files-changed")).toBe(true);
});
