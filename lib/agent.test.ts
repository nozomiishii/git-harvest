import { expect, test } from "vitest";
import { isClaudeWorktree, scopeOfPath } from "./agent";

// .claude/worktrees 配下は claude-worktree
test("scopeOfPath classifies a .claude/worktrees path as claude-worktree", () => {
  expect(scopeOfPath("/repo/.claude/worktrees/foo")).toBe("claude-worktree");
});

// 通常 path は worktree
test("scopeOfPath classifies a normal path as worktree", () => {
  expect(scopeOfPath("/repo/feature-wt")).toBe("worktree");
});

// .claude/worktrees の後に1文字以上で初めて claude worktree
test("isClaudeWorktree requires at least one char after .claude/worktrees/", () => {
  expect(isClaudeWorktree("/repo/.claude/worktrees")).toBe(false);
  expect(isClaudeWorktree("/repo/.claude/worktrees/x")).toBe(true);
});
