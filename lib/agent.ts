import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { canonical, isInside } from "./path";

// Claude Code は実行中 session の情報を ~/.claude/sessions/*.json に置く。
// その cwd がこの worktree 配下で、かつ process が生きていれば「session 実行中」と判定する
export function hasRunningClaudeSession(worktree: string): boolean {
  const target = canonical(worktree);

  return sessionFiles(sessionsDir()).some((file) => isLiveSessionIn({ file, target }));
}

export function isClaudeWorktree(candidate: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(candidate);
}

export function scopeOfPath(candidate: string): "claude-worktree" | "worktree" {
  return isClaudeWorktree(candidate) ? "claude-worktree" : "worktree";
}

// 1 つの session ファイルが「target worktree（サブディレクトリ含む）で生きている session」か
function isLiveSessionIn({ file, target }: { file: string; target: string }): boolean {
  const session = readSession(file);

  // 壊れた / cwd 欠損の session は対象外
  if (!session?.cwd) {
    return false;
  }

  // session が worktree のサブディレクトリで起動されていても検出する
  if (!isInside({ child: canonical(session.cwd), parent: target })) {
    return false;
  }
  // pid は JSON 本文を正とし、無ければ <pid>.json 形式のファイル名から取る（命名規則は非公開・無保証）
  const pid = session.pid ?? Number(path.basename(file, ".json"));

  return isProcessAlive(pid);
}

// NaN / pid 0 は dead 扱い
function isProcessAlive(pid: number): boolean {
  if (!pid) {
    return false;
  }

  try {
    // signal 0 は送信せず生存確認のみ（kill しない）。成功 = process 生存 = session 走行中
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

// 壊れた JSON はセッション扱いしない
function readSession(file: string): undefined | { cwd?: string; pid?: number } {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { cwd?: string; pid?: number };
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
