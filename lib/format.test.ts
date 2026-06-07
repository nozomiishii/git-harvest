import { expect, test } from "vitest";
import { relpath, statusLine } from "./format";

// home dir は ~ に短縮
test("relpath shortens the home directory to a tilde", () => {
  const home = process.env.HOME ?? "";

  expect(relpath(`${home}/repo/x`)).toBe("~/repo/x");
});

// kept 行は reason ラベルと区切り · を含む
test("statusLine renders a kept item with its reason label without color", () => {
  const line = statusLine({ action: "kept", name: "wt", reason: "untouched" }, false);

  expect(line).toContain("untouched");
  expect(line).toContain("·");
});

// removed 行は ✓ を含む
test("statusLine renders a removed item with a check mark", () => {
  expect(statusLine({ action: "removed", name: "wt" }, false)).toContain("✓");
});
