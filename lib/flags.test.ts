import { expect, test } from "vitest";
import { defaultFlags, parseFlags, subcommandOf } from "./flags";

// default は全 scope merged で toggle 無効
test("defaultFlags keeps every scope at merged and toggles off", () => {
  const f = defaultFlags();

  expect(f.thresholds).toStrictEqual({
    branch: "merged",
    "claude-worktree": "merged",
    worktree: "merged",
  });
  expect(f.untouched).toBe(false);
  expect(f.detached).toBe(false);
});

// scope 指定は対象 scope だけ閾値を下げる
test("--committed=claude-worktree lowers only the claude scope", () => {
  const flags = parseFlags(["--committed=claude-worktree"]);

  expect(flags.thresholds["claude-worktree"]).toBe("committed");
  expect(flags.thresholds.worktree).toBe("merged");
});

// 値無し stage フラグは許可された全 scope に効く（--files-changed は branch 対象外）
test("bare stage flags lower every allowed scope", () => {
  expect(parseFlags(["--committed"]).thresholds).toStrictEqual({
    branch: "committed",
    "claude-worktree": "committed",
    worktree: "committed",
  });
  expect(parseFlags(["--files-changed"]).thresholds).toStrictEqual({
    branch: "merged",
    "claude-worktree": "files-changed",
    worktree: "files-changed",
  });
});

// branch に files-changed は許さず error
test("--files-changed=branch is rejected", () => {
  expect(() => parseFlags(["--files-changed=branch"])).toThrow(/invalid scope/);
});

// = を含む不正 scope は切り詰めて受理せず error（split("=", 2) の残り捨て対策）
test("a malformed scope value containing '=' is rejected", () => {
  expect(() => parseFlags(["--committed=worktree=x"])).toThrow(/invalid scope/);
});

// 空値 --committed= は全 scope に化けず error にする（変数の空展開対策）
test("an empty scope value like --committed= is rejected", () => {
  expect(() => parseFlags(["--committed="])).toThrow(/invalid scope/);
});

// カンマ区切りで列挙した各 scope に適用
test("comma-separated scopes apply to each listed scope", () => {
  const flags = parseFlags(["--files-changed=worktree,claude-worktree"]);

  expect(flags.thresholds["claude-worktree"]).toBe("files-changed");
});

// --untouched / --detached は off-ladder toggle を立てる
test("--untouched and --detached set the off-ladder toggles", () => {
  const flags = parseFlags(["--untouched", "--detached"]);

  expect(flags.untouched).toBe(true);
  expect(flags.detached).toBe(true);
});

// --yolo の展開結果を spec の具体値で固定（経路非依存に検証）
test("--yolo lowers every scope to its most aggressive stage and enables both toggles", () => {
  const flags = parseFlags(["--yolo"]);

  expect(flags.thresholds).toStrictEqual({
    branch: "committed",
    "claude-worktree": "files-changed",
    worktree: "files-changed",
  });
  expect(flags.untouched).toBe(true);
  expect(flags.detached).toBe(true);
});

// 安全側フラグを後から足しても、より危険な閾値は保持される（lower の order 非依存）
test("a safer flag after a riskier one keeps the riskier threshold", () => {
  expect(parseFlags(["--files-changed=worktree", "--committed=worktree"]).thresholds.worktree).toBe(
    "files-changed",
  );
});

// -n は dry-run を立てる
test("-n sets dry-run mode", () => {
  expect(parseFlags(["-n"]).dryRun).toBe(true);
});

// 未知フラグは error
test("an unknown flag throws", () => {
  expect(() => parseFlags(["--nope"])).toThrow(/unknown option/);
});

// 脱出口 (help / version / logo) は argv のどこにあっても他の引数より優先される
test("subcommandOf detects escape hatches anywhere in argv", () => {
  expect(subcommandOf(["--nope", "--help"])).toBe("help");
  expect(subcommandOf(["-v"])).toBe("version");
  expect(subcommandOf(["logo"])).toBe("logo");
  expect(subcommandOf(["--committed"])).toBeUndefined();
});
