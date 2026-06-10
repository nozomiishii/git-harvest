import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { hasRunningClaudeSession, isClaudeWorktree, scopeOfPath } from "./agent";

// session が worktree のサブディレクトリで起動されていても検出する（保護の偽陰性防止）
test("hasRunningClaudeSession detects a session started in a subdirectory", () => {
  const sessions = mkdtempSync(path.join(tmpdir(), "gh-sessions-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const sub = path.join(wt, "sub");
  mkdirSync(sub);
  writeFileSync(path.join(sessions, `${String(process.pid)}.json`), JSON.stringify({ cwd: sub }));
  process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR = sessions;

  try {
    expect(hasRunningClaudeSession(wt)).toBe(true);
  } finally {
    delete process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR;
    rmSync(sessions, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// 通常 path は worktree（claude-worktree 側は isClaudeWorktree の boundary テストでカバー）
test("scopeOfPath classifies a normal path as worktree", () => {
  expect(scopeOfPath("/repo/feature-wt")).toBe("worktree");
});

// .claude/worktrees の後に1文字以上で初めて claude worktree
test("isClaudeWorktree requires at least one char after .claude/worktrees/", () => {
  expect(isClaudeWorktree("/repo/.claude/worktrees")).toBe(false);
  expect(isClaudeWorktree("/repo/.claude/worktrees/x")).toBe(true);
});
