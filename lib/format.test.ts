import { expect, test } from "vitest";
import type { CleanupResult } from "./types";
import { formatResult, formatSummary } from "./format";
import { withNoColor } from "./test-helpers";

// ANSI エスケープを含まないことの共通アサート
function expectNoAnsi(s: string): void {
  expect(s).not.toContain("\u001B[");
}

// removed は ✓ マーカーと name をプレーンで含む
test("formatResult removed shows the success marker and name without ANSI", () => {
  using _ = withNoColor("1");
  const out = formatResult({ action: "removed", name: "feature-x" });

  expect(out).toContain("✓");
  expect(out).toContain("feature-x");

  expectNoAnsi(out);
});

// would-remove は → マーカーと name をプレーンで含む
test("formatResult would-remove shows the will-delete marker and name without ANSI", () => {
  using _ = withNoColor("1");
  const out = formatResult({ action: "would-remove", name: "feature-y" });

  expect(out).toContain("→");
  expect(out).toContain("feature-y");

  expectNoAnsi(out);
});

// kept は · マーカーと name と reason を含む
test("formatResult kept shows the protect marker, name and reason without ANSI", () => {
  using _ = withNoColor("1");
  const out = formatResult({ action: "kept", name: "feature-z", reason: "not merged" });

  expect(out).toContain("·");
  expect(out).toContain("feature-z");
  expect(out).toContain("not merged");

  expectNoAnsi(out);
});

// failed は name と error を含む
test("formatResult failed shows the name and error without ANSI", () => {
  using _ = withNoColor("1");
  const out = formatResult({ action: "failed", error: "permission denied", name: "feature-e" });

  expect(out).toContain("feature-e");
  expect(out).toContain("permission denied");

  expectNoAnsi(out);
});

// worktree と branch 両方の結果を見出し付きでまとめる
test("formatSummary renders both worktree and branch sections", () => {
  using _ = withNoColor("1");
  const worktree: CleanupResult = {
    failures: 0,
    results: [{ action: "removed", name: "/tmp/wt-a" }],
  };
  const branch: CleanupResult = {
    failures: 0,
    results: [{ action: "kept", name: "feature-a", reason: "currently checked out" }],
  };
  const out = formatSummary(worktree, branch);

  expect(out).toContain("Worktrees");
  expect(out).toContain("/tmp/wt-a");
  expect(out).toContain("Branches");
  expect(out).toContain("feature-a");
  expect(out).toContain("currently checked out");

  expectNoAnsi(out);
});

// 結果が空の scope は見出しを出さない
test("formatSummary omits a section header when its results are empty", () => {
  using _ = withNoColor("1");
  const worktree: CleanupResult = { failures: 0, results: [] };
  const branch: CleanupResult = {
    failures: 0,
    results: [{ action: "removed", name: "feature-b" }],
  };
  const out = formatSummary(worktree, branch);

  expect(out).not.toContain("Worktrees");
  expect(out).toContain("Branches");
  expect(out).toContain("feature-b");
});
