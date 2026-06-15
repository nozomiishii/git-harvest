import { expect, test } from "vitest";
import { defaultFlags, parseFlags, subcommandOf } from "./flags";

// default は全 scope の段フラグも off-ladder toggle も無効
test("defaultFlags keeps every scope off and toggles off", () => {
  const f = defaultFlags();

  expect(f.worktree).toStrictEqual({ committed: false, filesChanged: false });
  expect(f["claude-worktree"]).toStrictEqual({ committed: false, filesChanged: false });
  expect(f.branchCommitted).toBe(false);
  expect(f.untouched).toBe(false);
  expect(f.detached).toBe(false);
});

// scope 指定は対象 scope だけ committed を立てる
test("--committed=claude-worktree sets only the claude scope", () => {
  const flags = parseFlags(["--committed=claude-worktree"]);

  expect(flags["claude-worktree"].committed).toBe(true);
  expect(flags.worktree.committed).toBe(false);
  expect(flags.branchCommitted).toBe(false);
});

// 値無し --committed は branch を含む全 scope に効く
test("a bare --committed sets every scope including branch", () => {
  const flags = parseFlags(["--committed"]);

  expect(flags.worktree.committed).toBe(true);
  expect(flags["claude-worktree"].committed).toBe(true);
  expect(flags.branchCommitted).toBe(true);
});

// 値無し --files-changed は worktree 系のみ（branch は files-changed 段を持たない）
test("a bare --files-changed sets worktree scopes but leaves branch untouched", () => {
  const flags = parseFlags(["--files-changed"]);

  expect(flags.worktree.filesChanged).toBe(true);
  expect(flags["claude-worktree"].filesChanged).toBe(true);
  expect(flags.branchCommitted).toBe(false);
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

  expect(flags.worktree.filesChanged).toBe(true);
  expect(flags["claude-worktree"].filesChanged).toBe(true);
});

// --untouched / --detached は off-ladder toggle を立てる
test("--untouched and --detached set the off-ladder toggles", () => {
  const flags = parseFlags(["--untouched", "--detached"]);

  expect(flags.untouched).toBe(true);
  expect(flags.detached).toBe(true);
});

// --yolo の展開結果を spec の具体値で固定（経路非依存に検証）
test("--yolo sets every scope to its most aggressive stage and enables both toggles", () => {
  const flags = parseFlags(["--yolo"]);

  expect(flags.worktree).toStrictEqual({ committed: true, filesChanged: true });
  expect(flags["claude-worktree"]).toStrictEqual({ committed: true, filesChanged: true });
  expect(flags.branchCommitted).toBe(true);
  expect(flags.untouched).toBe(true);
  expect(flags.detached).toBe(true);
});

// 危険側フラグを立てた後に安全側フラグを足しても、危険側の段は残る（toggle は単調）
test("setting --committed after --files-changed keeps the files-changed stage active", () => {
  const flags = parseFlags(["--files-changed=worktree", "--committed=worktree"]);

  expect(flags.worktree.filesChanged).toBe(true);
  expect(flags.worktree.committed).toBe(true);
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
