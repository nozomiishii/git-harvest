import { expect, test } from "vitest";
import { applyToken, PRESETS } from "./flags-spec";
import { defaultFlags } from "./preset";

// threshold フラグは scope の閾値を危険側へ下げる
test("applyToken lowers a scope threshold to the riskier stage", () => {
  const flags = defaultFlags();
  const matched = applyToken(flags, "--worktree-committed");

  expect(matched).toBe(true);
  expect(flags.worktree).toBe("committed");
});

// boolean フラグは対応する boolean を立てる
test("applyToken sets the boolean for an off-ladder flag", () => {
  const flags = defaultFlags();
  const matched = applyToken(flags, "--worktree-detached");

  expect(matched).toBe(true);
  expect(flags.worktreeDetached).toBe(true);
});

// 危険側が勝つ: committed の後に files-changed を適用すると files-changed
test("applyToken keeps the riskier stage when flags combine", () => {
  const flags = defaultFlags();
  applyToken(flags, "--worktree-committed");
  applyToken(flags, "--worktree-files-changed");

  expect(flags.worktree).toBe("files-changed");
});

// より安全側へは戻さない: files-changed は後から committed を当てても変わらない
test("applyToken never relaxes a threshold back to a safer stage", () => {
  const flags = defaultFlags();
  applyToken(flags, "--worktree-files-changed");
  applyToken(flags, "--worktree-committed");

  expect(flags.worktree).toBe("files-changed");
});

// 未知 token は不一致を返し flags を変えない
test("applyToken returns false for an unknown token and leaves flags untouched", () => {
  const flags = defaultFlags();
  const matched = applyToken(flags, "--nope");

  expect(matched).toBe(false);
  expect(flags).toStrictEqual(defaultFlags());
});

// --yolo の束を default に展開すると invariant 以外を全部消す設定になる
test("yolo preset expands to the all-aggressive flag set", () => {
  const flags = defaultFlags();

  for (const token of PRESETS.yolo) applyToken(flags, token);

  expect(flags).toStrictEqual({
    branch: "committed",
    claudeWorktree: "files-changed",
    claudeWorktreeDetached: true,
    claudeWorktreeUntouched: true,
    dryRun: false,
    worktree: "files-changed",
    worktreeDetached: true,
    worktreeUntouched: true,
  });
});
