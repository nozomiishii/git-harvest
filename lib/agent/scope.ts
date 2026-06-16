export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

export function scopeOfPath(candidate: string): "claude-worktree" | "worktree" {
  return isClaudeWorktree(candidate) ? "claude-worktree" : "worktree";
}
