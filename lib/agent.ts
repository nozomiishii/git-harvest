import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function hasRunningClaudeSession(worktree: string): boolean {
  const dir = sessionsDir();
  let files: string[];

  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
  const target = canonical(worktree);

  for (const file of files) {
    let session: { cwd?: string };

    try {
      session = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as { cwd?: string };
    } catch {
      continue;
    }

    if (!session.cwd || canonical(session.cwd) !== target) {
      continue;
    }
    const pid = Number(file.replace(/\.json$/, "")); // <pid>.json から pid を取る

    if (!pid) {
      continue;
    }

    try {
      process.kill(pid, 0);

      return true;
    } catch {
      continue;
    }
  }

  return false;
}

export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

export function scopeOfPath(candidate: string): "claude-worktree" | "worktree" {
  return isClaudeWorktree(candidate) ? "claude-worktree" : "worktree";
}

function canonical(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

function sessionsDir(): string {
  return (
    process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions")
  );
}
