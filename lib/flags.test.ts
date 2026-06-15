import { expect, test } from "vitest";
import { defaultFlags, parseFlags, subcommandOf } from "./flags";

// default は committed / files-changed の対象 scope が空で、off-ladder toggle も無効
test("defaultFlags targets no scope and leaves toggles off", () => {
  const f = defaultFlags();

  expect(f.committed).toStrictEqual([]);
  expect(f.filesChanged).toStrictEqual([]);
  expect(f.untouched).toBe(false);
  expect(f.detached).toBe(false);
});

// scope 指定は対象 scope だけ committed に入れる
test("--committed=claude-worktree targets only the claude scope", () => {
  expect(parseFlags(["--committed=claude-worktree"]).committed).toStrictEqual(["claude-worktree"]);
});

// 値無し --committed は branch を含む全 scope を対象にする
test("a bare --committed targets every scope including branch", () => {
  expect(parseFlags(["--committed"]).committed).toStrictEqual([
    "worktree",
    "claude-worktree",
    "branch",
  ]);
});

// 値無し --files-changed は worktree 系のみ（branch は files-changed 段を持たない）
test("a bare --files-changed targets worktree scopes but not branch", () => {
  const flags = parseFlags(["--files-changed"]);

  expect(flags.filesChanged).toStrictEqual(["worktree", "claude-worktree"]);
  expect(flags.committed).toStrictEqual([]);
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

// カンマ区切りで列挙した各 scope を対象にする
test("comma-separated scopes apply to each listed scope", () => {
  expect(parseFlags(["--files-changed=worktree,claude-worktree"]).filesChanged).toStrictEqual([
    "worktree",
    "claude-worktree",
  ]);
});

// --untouched / --detached は off-ladder toggle を立てる
test("--untouched and --detached set the off-ladder toggles", () => {
  const flags = parseFlags(["--untouched", "--detached"]);

  expect(flags.untouched).toBe(true);
  expect(flags.detached).toBe(true);
});

// --yolo の展開結果を spec の具体値で固定（経路非依存に検証）
test("--yolo targets every scope and enables both toggles", () => {
  const flags = parseFlags(["--yolo"]);

  expect(flags.committed).toStrictEqual(["worktree", "claude-worktree", "branch"]);
  expect(flags.filesChanged).toStrictEqual(["worktree", "claude-worktree"]);
  expect(flags.untouched).toBe(true);
  expect(flags.detached).toBe(true);
});

// 同じ scope を committed と files-changed の両方の対象にできる（重ねても両方残る）
test("a scope can be targeted by both committed and files-changed", () => {
  const flags = parseFlags(["--files-changed=worktree", "--committed=worktree"]);

  expect(flags.filesChanged).toContain("worktree");
  expect(flags.committed).toContain("worktree");
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
