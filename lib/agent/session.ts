import { globSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { isInside, realpath } from "../path";

const MAX_CODEX_PROCESS_MANAGER_BYTES = 1024 * 1024;
const CODEX_PROCESS_MANAGER_ACTIVE_MS = 24 * 60 * 60 * 1000;
const CODEX_PROCESS_MANAGER_CLOCK_SKEW_MS = 5 * 60 * 1000;

type CodexProcess = {
  cwd?: string;
  osPid?: null | number | string;
  processId?: null | number | string;
  updatedAtMs?: null | number | string;
};

// 実行中 agent の cwd がこの worktree 配下なら「session 実行中」と判定する
export function hasRunningAgentSession(worktree: string): boolean {
  return hasRunningClaudeSession(worktree) || hasRunningCodexProcess(worktree);
}

export function hasRunningClaudeSession(worktree: string): boolean {
  const target = realpath(worktree);

  return sessionFiles(sessionsDir()).some((file) => isLiveSessionIn({ file, target }));
}

export function hasRunningCodexProcess(worktree: string): boolean {
  const target = realpath(worktree);

  return codexProcesses(processManagerFile()).some((process) =>
    isLiveCodexProcessIn({ process, target }),
  );
}

// Codex app の process manager は公開 API ではないため、単一ファイルの最小 metadata だけを best-effort で読む
function codexProcesses(file: string): CodexProcess[] {
  try {
    if (statSync(file).size > MAX_CODEX_PROCESS_MANAGER_BYTES) {
      return [];
    }
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));

    return Array.isArray(parsed) ? (parsed as CodexProcess[]) : [];
  } catch {
    return [];
  }
}

function isLiveCodexProcessIn({
  process,
  target,
}: {
  process: CodexProcess;
  target: string;
}): boolean {
  if (!process.cwd) {
    return false;
  }

  if (!isInside({ child: realpath(process.cwd), parent: target })) {
    return false;
  }

  // Codex processId は OS pid ではないため、osPid と更新時刻を別の signal として扱う
  return isProcessAlive(Number(process.osPid)) || isRecentlyUpdatedCodexProcess(process);
}

// Claude Code は実行中 session の情報を ~/.claude/sessions/*.json に置く
// 1 つの session ファイルが「target worktree（サブディレクトリ含む）で生きている session」か
function isLiveSessionIn({ file, target }: { file: string; target: string }): boolean {
  const session = readSession(file);

  // 壊れた / cwd 欠損の session は対象外
  if (!session?.cwd) {
    return false;
  }

  // session が worktree のサブディレクトリで起動されていても検出する
  if (!isInside({ child: realpath(session.cwd), parent: target })) {
    return false;
  }
  // pid は JSON 本文を正とし、無ければ <pid>.json 形式のファイル名から取る（命名規則は非公開・無保証）
  const pid = session.pid ?? Number(path.basename(file, ".json"));

  return isProcessAlive(pid);
}

// 数値で無い pid（NaN）や 0 は「生きていない」と扱う
function isProcessAlive(pid: number): boolean {
  if (!pid) {
    return false;
  }

  try {
    // process.kill に signal 0 を渡すと、プロセスを実際には殺さず存在確認だけ行う
    // （POSIX の慣習）。例外が出なければ生きている = session 走行中
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

function isRecentlyUpdatedCodexProcess(process: CodexProcess): boolean {
  const updatedAtMs = Number(process.updatedAtMs);

  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  const ageMs = Date.now() - updatedAtMs;

  return ageMs >= -CODEX_PROCESS_MANAGER_CLOCK_SKEW_MS && ageMs <= CODEX_PROCESS_MANAGER_ACTIVE_MS;
}

function processManagerFile(): string {
  return (
    env.GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE ??
    path.join(
      env.CODEX_HOME ?? path.join(homedir(), ".codex"),
      "process_manager",
      "chat_processes.json",
    )
  );
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
    return globSync(path.join(dir, "*.json"));
  } catch {
    return [];
  }
}

function sessionsDir(): string {
  return env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
}
