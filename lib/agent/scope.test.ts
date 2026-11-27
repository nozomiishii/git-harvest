import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import {
  isAntigravityWorktree,
  isClaudeWorktree,
  isCodexWorktree,
  isGrokWorktree,
  scopeOfPath,
} from "./scope";

// 通常 path は worktree（専用 scope 側は boundary テストでカバー）
test("scopeOfPath classifies a normal path as worktree", () => {
  expect(scopeOfPath("/repo/feature-wt")).toBe("worktree");
});

// .codex/worktrees 配下は Codex 専用 scope
test("scopeOfPath classifies a codex worktree path as codex-worktree", () => {
  expect(scopeOfPath("/Users/test-user/.codex/worktrees/2387/git-harvest")).toBe("codex-worktree");
});

// CODEX_HOME を変えた環境では、その worktrees 配下を Codex 専用 scope にする
test("scopeOfPath classifies a CODEX_HOME worktree path as codex-worktree", () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), "gh-codex-home-"));
  const worktree = path.join(codexHome, "worktrees", "2387", "git-harvest");
  mkdirSync(worktree, { recursive: true });
  vi.stubEnv("CODEX_HOME", codexHome);

  try {
    expect(scopeOfPath(worktree)).toBe("codex-worktree");
  } finally {
    vi.unstubAllEnvs();
    rmSync(codexHome, { force: true, recursive: true });
  }
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

test("scopeOfPath は Antigravity の worktree パスを antigravity-worktree に分類する", () => {
  expect(
    scopeOfPath("/Users/test-user/.gemini/antigravity/worktrees/dotfiles/refactor_doc_skill"),
  ).toBe("antigravity-worktree");
});

test("scopeOfPath は GIT_HARVEST_ANTIGRAVITY_HOME 配下の worktree を antigravity-worktree に分類する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const worktree = path.join(agyHome, "worktrees", "dotfiles", "refactor_doc_skill");
  mkdirSync(worktree, { recursive: true });
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(scopeOfPath(worktree)).toBe("antigravity-worktree");
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
  }
});

test("isAntigravityWorktree は .gemini/antigravity/worktrees/ の後に1文字以上を要求する", () => {
  expect(isAntigravityWorktree("/Users/test-user/.gemini/antigravity/worktrees")).toBe(false);
  expect(
    isAntigravityWorktree("/Users/test-user/.gemini/antigravity/worktrees/dotfiles/task"),
  ).toBe(true);
});

test("scopeOfPath は Grok Build の worktree パスを grok-worktree に分類する", () => {
  expect(scopeOfPath("/Users/test-user/.grok/worktrees/git-harvest/my-fix")).toBe("grok-worktree");
});

test("scopeOfPath は GROK_HOME 配下の worktree を grok-worktree に分類する", () => {
  const grokHome = mkdtempSync(path.join(tmpdir(), "gh-grok-home-"));
  const worktree = path.join(grokHome, "worktrees", "git-harvest", "my-fix");
  mkdirSync(worktree, { recursive: true });
  vi.stubEnv("GROK_HOME", grokHome);

  try {
    expect(scopeOfPath(worktree)).toBe("grok-worktree");
  } finally {
    vi.unstubAllEnvs();
    rmSync(grokHome, { force: true, recursive: true });
  }
});

test("isGrokWorktree は .grok/worktrees/ の後に1文字以上を要求する", () => {
  expect(isGrokWorktree("/Users/test-user/.grok/worktrees")).toBe(false);
  expect(isGrokWorktree("/Users/test-user/.grok/worktrees/git-harvest/my-fix")).toBe(true);
});
