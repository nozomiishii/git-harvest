export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

export function isCodexWorktree(candidate: string): boolean {
  return /\/\.codex\/worktrees\/.+/.test(candidate);
}

export function scopeOfPath(candidate: string): "claude-worktree" | "codex-worktree" | "worktree" {
  if (isClaudeWorktree(candidate)) {
    return "claude-worktree";
  }

  return isCodexWorktree(candidate) ? "codex-worktree" : "worktree";
}
