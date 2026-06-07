import { expect, test } from "vitest";
import { defaultFlags, parseArgs } from "./flags";

// default は全 scope merged で toggle 無効
test("defaultFlags keeps every scope at merged and toggles off", () => {
  const f = defaultFlags();

  expect(f.thresholds).toEqual({
    branch: "merged",
    "claude-worktree": "merged",
    worktree: "merged",
  });
  expect(f.untouched).toBe(false);
  expect(f.detached).toBe(false);
});

// scope 指定は対象 scope だけ閾値を下げる
test("--committed=claude-worktree lowers only the claude scope", () => {
  const p = parseArgs(["--committed=claude-worktree"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.thresholds["claude-worktree"]).toBe("committed");
  expect(p.flags.thresholds.worktree).toBe("merged");
});

// 値無し --committed は全 scope に効く
test("bare --committed lowers all scopes", () => {
  const p = parseArgs(["--committed"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.thresholds).toEqual({
    branch: "committed",
    "claude-worktree": "committed",
    worktree: "committed",
  });
});

// 値無し --files-changed は worktree 系のみで branch は対象外
test("bare --files-changed affects worktree scopes but not branch", () => {
  const p = parseArgs(["--files-changed"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.thresholds.worktree).toBe("files-changed");
  expect(p.flags.thresholds.branch).toBe("merged");
});

// branch に files-changed は許さず error
test("--files-changed=branch is rejected", () => {
  expect(() => parseArgs(["--files-changed=branch"])).toThrow(/invalid scope/);
});

// 空値 --committed= は全 scope に化けず error にする（変数の空展開対策）
test("an empty scope value like --committed= is rejected", () => {
  expect(() => parseArgs(["--committed="])).toThrow(/invalid scope/);
});

// カンマ区切りで列挙した各 scope に適用
test("comma-separated scopes apply to each listed scope", () => {
  const p = parseArgs(["--files-changed=worktree,claude-worktree"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.thresholds["claude-worktree"]).toBe("files-changed");
});

// --untouched / --detached は off-ladder toggle を立てる
test("--untouched and --detached set the off-ladder toggles", () => {
  const p = parseArgs(["--untouched", "--detached"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.untouched).toBe(true);
  expect(p.flags.detached).toBe(true);
});

// --yolo の展開結果を spec の具体値で固定（経路非依存に検証）
test("--yolo lowers every scope to its most aggressive stage and enables both toggles", () => {
  const p = parseArgs(["--yolo"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.thresholds).toEqual({
    branch: "committed",
    "claude-worktree": "files-changed",
    worktree: "files-changed",
  });
  expect(p.flags.untouched).toBe(true);
  expect(p.flags.detached).toBe(true);
});

// 安全側フラグを後から足しても、より危険な閾値は保持される（lower の order 非依存）
test("a safer flag after a riskier one keeps the riskier threshold", () => {
  const p = parseArgs(["--files-changed=worktree", "--committed=worktree"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.thresholds.worktree).toBe("files-changed");
});

// -n は dry-run を立てる
test("-n sets dry-run mode", () => {
  const p = parseArgs(["-n"]);

  if (p.mode !== "run") {
    throw new Error("run");
  }

  expect(p.flags.dryRun).toBe(true);
});

// 未知フラグは error
test("an unknown flag throws", () => {
  expect(() => parseArgs(["--nope"])).toThrow(/unknown option/);
});

// --help は help mode へ即分岐
test("--help short-circuits to help mode", () => {
  expect(parseArgs(["--help"]).mode).toBe("help");
});
