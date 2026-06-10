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

    // session が worktree のサブディレクトリで起動されていても検出する（sep 付き比較で前方一致誤判定を防ぐ）
    if (!session.cwd || !(canonical(session.cwd) + path.sep).startsWith(target + path.sep)) {
      continue;
    }
    const pid = Number(file.replace(/\.json$/, "")); // <pid>.json から pid を取る

    if (!pid) {
      continue;
    }

    try {
      // signal 0 は送信せず生存確認のみ（kill しない）。成功 = process 生存 = session 走行中
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
  return process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
}
