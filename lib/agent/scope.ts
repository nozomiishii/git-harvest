import { homedir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import type { WorktreeScope } from "../types";
import { isInside, realpath } from "../path";

/**
パス表記または Antigravity のホーム配下への包含で Antigravity の worktree か調べる。

@param candidate - 判定するパス。

@returns 該当する場合は true。
*/
export function isAntigravityWorktree(candidate: string): boolean {
  return (
    /\/\.gemini\/antigravity\/worktrees\/.+/.test(candidate) ||
    isWorktreeUnder({ candidate, worktreesDir: antigravityWorktreesDir() })
  );
}

/**
パスが Claude Code の worktree ディレクトリを含むか調べる。

@param candidate - 判定するパス。

@returns 該当する場合は true。
*/
export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

/**
パス表記または CODEX_HOME 配下への包含で Codex の worktree か調べる。

@param candidate - 判定するパス。

@returns 該当する場合は true。
*/
export function isCodexWorktree(candidate: string): boolean {
  return (
    /\/\.codex\/worktrees\/.+/.test(candidate) ||
    isWorktreeUnder({ candidate, worktreesDir: codexWorktreesDir() })
  );
}

/**
パス表記または GROK_HOME 配下への包含で Grok Build の worktree か調べる。

@param candidate - 判定するパス。

@returns 該当する場合は true。
*/
export function isGrokWorktree(candidate: string): boolean {
  return (
    /\/\.grok\/worktrees\/.+/.test(candidate) ||
    isWorktreeUnder({ candidate, worktreesDir: grokWorktreesDir() })
  );
}

/**
worktree のパスから管理元の scope を決める。

@param candidate - 判定するパス。

@returns パスに対応する scope。
*/
export function scopeOfPath(candidate: string): WorktreeScope {
  if (isClaudeWorktree(candidate)) {
    return "claude-worktree";
  }

  if (isCodexWorktree(candidate)) {
    return "codex-worktree";
  }

  if (isAntigravityWorktree(candidate)) {
    return "antigravity-worktree";
  }

  return isGrokWorktree(candidate) ? "grok-worktree" : "worktree";
}

/**
Antigravity の worktree ディレクトリを求める。

@returns Antigravity の worktrees ディレクトリ。
*/
function antigravityWorktreesDir(): string {
  if (env.GIT_HARVEST_ANTIGRAVITY_HOME) {
    return path.join(env.GIT_HARVEST_ANTIGRAVITY_HOME, "worktrees");
  }

  return path.join(homedir(), ".gemini", "antigravity", "worktrees");
}

/**
CODEX_HOME を基に Codex の worktree ディレクトリを求める。

@returns Codex の worktrees ディレクトリ。
*/
function codexWorktreesDir(): string {
  if (env.CODEX_HOME) {
    return path.join(env.CODEX_HOME, "worktrees");
  }

  return path.join(homedir(), ".codex", "worktrees");
}

/**
GROK_HOME を基に Grok Build の worktree ディレクトリを求める。

@returns Grok Build の worktrees ディレクトリ。
*/
function grokWorktreesDir(): string {
  if (env.GROK_HOME) {
    return path.join(env.GROK_HOME, "worktrees");
  }

  return path.join(homedir(), ".grok", "worktrees");
}

/**
パスを正規化して指定の worktrees ディレクトリ配下か調べる。

@param root0 - 判定するパスと基準ディレクトリ。

@param root0.candidate - 判定するパス。

@param root0.worktreesDir - 基準となる worktrees ディレクトリ。

@returns 該当する場合は true。
*/
function isWorktreeUnder({
  candidate,
  worktreesDir,
}: {
  candidate: string;
  worktreesDir: string;
}): boolean {
  const child = realpath(candidate);
  const parent = realpath(worktreesDir);

  return child !== parent && isInside({ child, parent });
}
