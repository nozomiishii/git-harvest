import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function hasRunningClaudeSession(worktree: string): boolean {
  const target = canonical(worktree);

  for (const file of sessionFiles(sessionsDir())) {
    const session = readSession(file);

    // session が worktree のサブディレクトリで起動されていても検出する（sep 付き比較で前方一致誤判定を防ぐ）
    if (!session?.cwd || !(canonical(session.cwd) + path.sep).startsWith(target + path.sep)) {
      continue;
    }
    const pid = Number(path.basename(file, ".json")); // <pid>.json から pid を取る

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

// 壊れた JSON はセッション扱いしない
function readSession(file: string): undefined | { cwd?: string } {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { cwd?: string };
  } catch {
    return undefined;
  }
}

// sessions dir が無い環境（Claude 未使用 等）は空扱い
function sessionFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function sessionsDir(): string {
  return process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
}
