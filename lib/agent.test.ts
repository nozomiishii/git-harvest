import { expect, test } from "vitest";
import { isClaudeWorktree, scopeOfPath } from "./agent";

// 通常 path は worktree（claude-worktree 側は isClaudeWorktree の boundary テストでカバー）
test("scopeOfPath classifies a normal path as worktree", () => {
  expect(scopeOfPath("/repo/feature-wt")).toBe("worktree");
});

// .claude/worktrees の後に1文字以上で初めて claude worktree
test("isClaudeWorktree requires at least one char after .claude/worktrees/", () => {
  expect(isClaudeWorktree("/repo/.claude/worktrees")).toBe(false);
  expect(isClaudeWorktree("/repo/.claude/worktrees/x")).toBe(true);
});
