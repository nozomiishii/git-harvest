import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { isInside, realpath } from "../path";

interface AntigravityConversationRow {
  conversation_id: string;
  workspace_uris: string;
}

interface GrokActiveSession {
  cwd?: unknown;
  pid?: unknown;
}

/**
worktree 内を workspace とする未アーカイブの Antigravity root 会話があるか調べる。
実行中かどうかは判定しない。

@param worktree - 対象の worktree。

@returns 該当する会話があれば true。
*/
export function hasActiveAntigravityConversation(worktree: string): boolean {
  const target = realpath(worktree);

  return activeAntigravityWorkspacePaths(antigravityHome()).some((dir) =>
    isInside({ child: realpath(dir), parent: target }),
  );
}

/**
worktree 内を cwd とする未アーカイブの Codex user thread があるか調べる。
実行中かどうかは判定しない。

@param worktree - 対象の worktree。

@returns 該当する thread があれば true。
*/
export function hasActiveCodexThread(worktree: string): boolean {
  const target = realpath(worktree);

  return activeCodexThreadCwds(codexStateDb()).some((cwd) =>
    isInside({ child: realpath(cwd), parent: target }),
  );
}

/**
worktree を保護する実行中セッションまたは未アーカイブの会話があるか調べる。
Codex user thread と Antigravity root 会話は未アーカイブなら待機中も対象になる。

@param worktree - 対象の worktree。

@returns 保護対象の session または会話があれば true。
*/
export function hasRunningAgentSession(worktree: string): boolean {
  return (
    hasRunningClaudeSession(worktree) ||
    hasActiveCodexThread(worktree) ||
    hasActiveAntigravityConversation(worktree) ||
    hasRunningGrokSession(worktree)
  );
}

/**
worktree 内で実行中の Claude Code session があるか調べる。

@param worktree - 対象の worktree。

@returns 該当する session があれば true。
*/
export function hasRunningClaudeSession(worktree: string): boolean {
  const target = realpath(worktree);

  return sessionFiles(sessionsDir()).some((file) => isLiveSessionIn({ file, target }));
}

/**
worktree 内で実行中の Grok Build session があるか調べる。

@param worktree - 対象の worktree。

@returns 該当する session があれば true。
*/
export function hasRunningGrokSession(worktree: string): boolean {
  const target = realpath(worktree);

  return readGrokActiveSessions(grokActiveSessionsFile()).some((session) =>
    isLiveGrokSessionIn({ session, target }),
  );
}

/**
Antigravity の DB と annotations から未アーカイブの root 会話の workspace パス一覧を読む。
DB が無い場合や読めない場合は空配列を返す。

@param baseDir - Antigravity ホームディレクトリのパス。

@returns 読み取れた workspace パスの一覧。
*/
function activeAntigravityWorkspacePaths(baseDir: string): string[] {
  const dbPath = path.join(baseDir, "conversation_summaries.db");

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });

    try {
      const rows = db
        .prepare(
          "SELECT conversation_id, workspace_uris FROM conversation_summaries WHERE (parent_conversation_id IS NULL OR parent_conversation_id = '') AND (killed IS NULL OR killed = 0) AND workspace_uris IS NOT NULL AND workspace_uris != ''",
        )
        .all() as unknown as AntigravityConversationRow[];

      const paths: string[] = [];

      for (const row of rows) {
        if (isAntigravityConversationArchived({ baseDir, conversationId: row.conversation_id })) {
          continue;
        }
        paths.push(...parseAntigravityWorkspacePaths(row.workspace_uris));
      }

      return paths;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/**
Codex の DB から未アーカイブの user thread の cwd を読む。
DB が無い場合や読めない場合は空配列を返す。

@param dbPath - 読み取る Codex state DB のパス。

@returns 読み取れた cwd の一覧。
*/
function activeCodexThreadCwds(dbPath: string): string[] {
  if (!dbPath) {
    return [];
  }

  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });

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
Antigravity のホームディレクトリを求める。

@returns Antigravity のホームディレクトリのパス。
*/
function antigravityHome(): string {
  if (env.GIT_HARVEST_ANTIGRAVITY_HOME) {
    return env.GIT_HARVEST_ANTIGRAVITY_HOME;
  }

  return path.join(homedir(), ".gemini", "antigravity");
}

/**
使用する Codex の state DB を見つける。
環境変数の指定があればそれを優先する。

@returns 指定された DB、または見つかった最新版の DB のパス。なければ空文字。
*/
function codexStateDb(): string {
  if (env.GIT_HARVEST_CODEX_STATE_DB) {
    return env.GIT_HARVEST_CODEX_STATE_DB;
  }

  const codexHome =
    env.CODEX_HOME && env.CODEX_HOME.length > 0 ? env.CODEX_HOME : path.join(homedir(), ".codex");

  try {
    const files = globSync(path.join(codexHome, "state_*.sqlite"));
    files.sort((a, b) => stateDbVersion(a) - stateDbVersion(b));

    return files.at(-1) ?? "";
  } catch {
    return "";
  }
}

/**
Grok Build の active_sessions.json のパスを求める。

@returns active_sessions.json のパス。
*/
function grokActiveSessionsFile(): string {
  if (env.GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE) {
    return env.GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE;
  }

  if (env.GROK_HOME) {
    return path.join(env.GROK_HOME, "active_sessions.json");
  }

  return path.join(homedir(), ".grok", "active_sessions.json");
}

/**
Antigravity の会話が annotations 上でアーカイブ済みか調べる。
ファイルが無い・読めない場合は安全側に倒して未アーカイブとみなす。

@param root0 - ベースディレクトリと会話 ID。

@param root0.baseDir - Antigravity ホームディレクトリのパス。

@param root0.conversationId - 対象の会話 ID。

@returns アーカイブ済みなら true。
*/
function isAntigravityConversationArchived({
  baseDir,
  conversationId,
}: {
  baseDir: string;
  conversationId: string;
}): boolean {
  if (!conversationId || path.basename(conversationId) !== conversationId) {
    return false;
  }

  try {
    const content = readFileSync(
      path.join(baseDir, "annotations", `${conversationId}.pbtxt`),
      "utf-8",
    );
    // title などの文字列リテラルに含まれる "archived: true" への誤爆を防ぐためクォート内を除去してから判定する
    const withoutStrings = content.replaceAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');

    return /\barchived:\s*true\b/.test(withoutStrings);
  } catch {
    return false;
  }
}

/**
Grok Build の session が対象 worktree 内で実行中か調べる。

@param root0 - session 情報と対象 worktree のパス。

@param root0.session - Grok Build の active session エントリ。

@param root0.target - 対象 worktree の実際のパス。

@returns 対象内で実行中なら true。
*/
function isLiveGrokSessionIn({
  session,
  target,
}: {
  session: GrokActiveSession;
  target: string;
}): boolean {
  if (typeof session.cwd !== "string" || !session.cwd || typeof session.pid !== "number") {
    return false;
  }

  if (!isInside({ child: realpath(session.cwd), parent: target })) {
    return false;
  }

  return isProcessAlive(session.pid);
}

/**
Claude Code の session が対象 worktree 内で実行中か調べる。
session の JSON を読み、対象のサブディレクトリも含める。

@param root0 - session ファイルと対象 worktree のパス。

@param root0.file - Claude Code の session ファイルのパス。

@param root0.target - 対象 worktree の実際のパス。

@returns 対象内で実行中なら true。
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
PID に対する signal 0 の照会が成功するか調べる。
正の整数でない PID や、照会で例外が出た場合は false にする。

@param pid - 照会するプロセス ID。

@returns signal 0 の照会が成功すれば true。
*/
function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
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
Antigravity の workspace_uris JSON 文字列からローカルパス一覧を取り出す。

@param raw - workspace_uris カラムの生文字列。

@returns 変換できたローカルパスの一覧。
*/
function parseAntigravityWorkspacePaths(raw: string): string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const paths: string[] = [];

  for (const uri of parsed) {
    if (typeof uri !== "string" || !uri.startsWith("file://")) {
      continue;
    }

    try {
      paths.push(fileURLToPath(uri));
    } catch {
      // 不正な file URI は無視する
    }
  }

  return paths;
}

/**
Grok Build の active_sessions.json を読む。
ファイルが無い場合や壊れた JSON は空配列を返す。

@param file - 読み取るファイルのパス。

@returns 読めた active session の一覧。
*/
function readGrokActiveSessions(file: string): GrokActiveSession[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (entry): entry is GrokActiveSession => entry !== null && typeof entry === "object",
    );
  } catch {
    return [];
  }
}

/**
Claude Code の session ファイルを読む。
壊れた JSON は session として扱わない。

@param file - 読み取るファイルのパス。

@returns 読めた session。読めなければ undefined。
*/
function readSession(file: string): undefined | { cwd?: string; pid?: number } {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as { cwd?: string; pid?: number };
  } catch {
    return undefined;
  }
}

/**
Claude Code の session ファイルを列挙する。
ディレクトリが無い環境では空配列を返す。

@param dir - session ディレクトリのパス。

@returns 見つかった JSON ファイルのパス。
*/
function sessionFiles(dir: string): string[] {
  try {
    return globSync(path.join(dir, "*.json"));
  } catch {
    return [];
  }
}

/**
Claude Code の session ディレクトリを求める。

@returns session ディレクトリのパス。
*/
function sessionsDir(): string {
  return env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), ".claude", "sessions");
}

/**
state DB のファイル名から版番号を読む。

@param file - 読み取るファイルのパス。

@returns 版番号。読み取れなければ 0。
*/
function stateDbVersion(file: string): number {
  return Number(path.basename(file, ".sqlite").split("_").pop()) || 0;
}
