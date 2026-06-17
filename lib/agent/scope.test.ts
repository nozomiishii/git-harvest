import { expect, test } from "vitest";
import { isClaudeWorktree, isCodexWorktree, scopeOfPath } from "./scope";

// 通常 path は worktree（専用 scope 側は boundary テストでカバー）
test("scopeOfPath classifies a normal path as worktree", () => {
  expect(scopeOfPath("/repo/feature-wt")).toBe("worktree");
});

// .codex/worktrees 配下は Codex 専用 scope
test("scopeOfPath classifies a codex worktree path as codex-worktree", () => {
  expect(scopeOfPath("/Users/test-user/.codex/worktrees/2387/git-harvest")).toBe("codex-worktree");
});

// .claude/worktrees の後に1文字以上で初めて claude worktree
test("isClaudeWorktree requires at least one char after .claude/worktrees/", () => {
  expect(isClaudeWorktree("/repo/.claude/worktrees")).toBe(false);
  expect(isClaudeWorktree("/repo/.claude/worktrees/x")).toBe(true);
});

// .codex/worktrees の後に1文字以上で初めて codex worktree
test("isCodexWorktree requires at least one char after .codex/worktrees/", () => {
  expect(isCodexWorktree("/Users/test-user/.codex/worktrees")).toBe(false);
  expect(isCodexWorktree("/Users/test-user/.codex/worktrees/2387/git-harvest")).toBe(true);
});
