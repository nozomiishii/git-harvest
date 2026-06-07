import { expect, test } from "vitest";
import { atOrSafer, SAFETY } from "./types";

// merged は files-changed 閾値以降（安全側）として削除対象
test("atOrSafer treats merged as deletable when threshold is files-changed", () => {
  expect(atOrSafer("merged", "files-changed")).toBe(true);
});

// committed は default 閾値 merged では消えない
test("atOrSafer keeps committed when threshold is merged", () => {
  expect(atOrSafer("committed", "merged")).toBe(false);
});

// SAFETY は危険 → 安全の順
test("SAFETY orders stages from risky to safe", () => {
  expect([...SAFETY]).toEqual(["files-changed", "committed", "merged"]);
});
