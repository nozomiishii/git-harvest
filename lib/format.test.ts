import { expect, test } from "vitest";
import { relpath, statusLine } from "./format";

// home dir は ~ に短縮
test("relpath shortens the home directory to a tilde", () => {
  const home = process.env.HOME ?? "";

  expect(relpath(`${home}/repo/x`)).toBe("~/repo/x");
});

// kept 行は reason ラベルと区切り · を、removed 行は ✓ を含む
test("statusLine renders each action", () => {
  const kept = statusLine({ action: "kept", name: "wt", reason: "untouched" }, false);

  expect(kept).toContain("untouched");
  expect(kept).toContain("·");
  expect(statusLine({ action: "removed", name: "wt" }, false)).toContain("✓");
});
