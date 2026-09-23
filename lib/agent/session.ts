import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { isInside, realpath } from "../path";

/**
 * worktree 内を cwd とする未アーカイブの Codex user thread があるか調べる。
 * 実行中かどうかは判定しない。
 *
 * @param worktree - 対象の worktree。
 *
 * @returns 該当する thread があれば true。
 */
export function hasActiveCodexThread(worktree: string): boolean {
  const target = realpath(worktree);

  return activeCodexThreadCwds(codexStateDb()).some((cwd) =>
    isInside({ child: realpath(cwd), parent: target }),
  );
}

/**
 * worktree を保護する Claude Code session または Codex user thread があるか調べる。
 * Codex user thread は未アーカイブなら待機中も対象になる。
 *
 * @param worktree - 対象の worktree。
 *
 * @returns 保護対象の session があれば true。
 */
export function hasRunningAgentSession(worktree: string): boolean {
  return hasRunningClaudeSession(worktree) || hasActiveCodexThread(worktree);
}

/**
 * worktree 内で実行中の Claude Code session があるか調べる。
 *
 * @param worktree - 対象の worktree。
 *
 * @returns 該当する session があれば true。
 */
export function hasRunningClaudeSession(worktree: string): boolean {
  const target = realpath(worktree);

  return sessionFiles(sessionsDir()).some((file) => isLiveSessionIn({ file, target }));
}

/**
 * Codex の DB から未アーカイブの user thread の cwd を読む。
 * DB が無い場合や読めない場合は空配列を返す。
 *
 * @param dbPath - 読み取る Codex state DB のパス。
 *
 * @returns 読み取れた cwd の一覧。
 */
function activeCodexThreadCwds(dbPath: string): string[] {
  if (!dbPath) {
    return [];
  }

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });

    try {
      return db
        .prepare(
          "SELECT cwd FROM threads WHERE archived = 0 AND thread_source = 'user' AND cwd IS NOT NULL",
        )
        .all()
        .map((row) => (row as { cwd: string }).cwd);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
 * 使用する Codex の state DB を見つける。
 * 環境変数の指定があればそれを優先する。
 *
 * @returns 指定された DB、または見つかった最新版の DB のパス。なければ空文字。
 */
function codexStateDb(): string {
  if (env.GIT_HARVEST_CODEX_STATE_DB) {
    return env.GIT_HARVEST_CODEX_STATE_DB;
  }

  const codexHome = env.CODEX_HOME ?? path.join(homedir(), ".codex");

  try {
    const files = globSync(path.join(codexHome, "state_*.sqlite"));
    files.sort((a, b) => stateDbVersion(a) - stateDbVersion(b));

    return files.at(-1) ?? "";
  } catch {
    return "";
  }
}

/**
 * Claude Code の session が対象 worktree 内で実行中か調べる。
 * session の JSON を読み、対象のサブディレクトリも含める。
 *
 * @param root0 - session ファイルと対象 worktree のパス。
 *
 * @param root0.file - Claude Code の session ファイルのパス。
 *
 * @param root0.target - 対象 worktree の実際のパス。
 *
 * @returns 対象内で実行中なら true。
 */
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
  // pid は JSON 本文を正とし、無ければ <pid>.JSON 形式のファイル名から取る（命名規則は非公開・無保証）
  const pid = session.pid ?? Number(path.basename(file, ".json"));

  return isProcessAlive(pid);
}

/**
 * PID に対する signal 0 の照会が成功するか調べる。
 * 0 や NaN、照会で例外が出た場合は false にする。
 *
 * @param pid - 照会するプロセス ID。
 *
 * @returns signal 0 の照会が成功すれば true。
 */
function isProcessAlive(pid: number): boolean {
  if (!pid) {
    return false;
  }

  try {
    // process.kill に signal 0 を渡すと、プロセスを実際には殺さず存在確認だけ行う
    // （POSIX の慣習）。例外が出なければ session のプロセスに照会できる
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/**
 * Claude Code の session ファイルを読む。
 * 壊れた JSON は session として扱わない。
 *
 * @param file - 読み取るファイルのパス。
 *
 * @returns 読めた session。読めなければ undefined。
 */
function readSession(file: string): undefined | { cwd?: string; pid?: number } {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as { cwd?: string; pid?: number };
  } catch {
    return undefined;
  }
}

/**
 * Claude Code の session ファイルを列挙する。
 * ディレクトリが無い環境では空配列を返す。
 *
 * @param dir - session ディレクトリのパス。
 *
 * @returns 見つかった JSON ファイルのパス。
 */
function sessionFiles(dir: string): string[] {
  try {
    return globSync(path.join(dir, "*.json"));
  } catch {
    return [];
  }
}

/**
 * Claude Code の session ディレクトリを求める。
 *
 * @returns session ディレクトリのパス。
 */
function sessionsDir(): string {
  return env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
}

/**
 * state DB のファイル名から版番号を読む。
 *
 * @param file - 読み取るファイルのパス。
 *
 * @returns 版番号。読み取れなければ 0。
 */
function stateDbVersion(file: string): number {
  return Number(path.basename(file, ".sqlite").split("_").pop()) || 0;
}
