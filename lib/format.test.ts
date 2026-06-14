import { homedir } from "node:os";
import { expect, test } from "vitest";
import { relpath, statusLine, summaryLine } from "./format";

// home dir は ~ に短縮
test("relpath shortens the home directory to a tilde", () => {
  expect(relpath(`${homedir()}/repo/x`)).toBe("~/repo/x");
});

// dry-run の合計行は「Harvested」と断言せず「Would harvest」にする（旧 bash の挙動）
test("summaryLine reports would-harvest in dry-run", () => {
  expect(summaryLine(2, true, false)).toContain("Would harvest 2 item(s)");
  expect(summaryLine(2, false, false)).toContain("Harvested 2 item(s)");
});

// kept 行は reason ラベルと区切り · を、removed 行は ✓ を含む
test("statusLine renders each action", () => {
  const kept = statusLine({ action: "kept", name: "wt", reason: "untouched" }, false);

  expect(kept).toContain("untouched");
  expect(kept).toContain("·");
  expect(statusLine({ action: "removed", name: "wt" }, false)).toContain("✓");
});
