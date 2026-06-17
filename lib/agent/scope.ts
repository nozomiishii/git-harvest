import { homedir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { isInside, realpath } from "../path";

export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

export function isCodexWorktree(candidate: string): boolean {
  return /\/\.codex\/worktrees\/.+/.test(candidate) || isCodexHomeWorktree(candidate);
}

export function scopeOfPath(candidate: string): "claude-worktree" | "codex-worktree" | "worktree" {
  if (isClaudeWorktree(candidate)) {
    return "claude-worktree";
  }

  return isCodexWorktree(candidate) ? "codex-worktree" : "worktree";
}

function codexWorktreesDir(): string {
  return path.join(env.CODEX_HOME ?? path.join(homedir(), ".codex"), "worktrees");
}

function isCodexHomeWorktree(candidate: string): boolean {
  const child = realpath(candidate);
  const parent = realpath(codexWorktreesDir());

  return child !== parent && isInside({ child, parent });
}
