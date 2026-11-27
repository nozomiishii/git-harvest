import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { createAntigravityState } from "../testing/antigravity-db";
import { createCodexStateDb } from "../testing/codex-db";
import {
  hasActiveAntigravityConversation,
  hasActiveCodexThread,
  hasRunningAgentSession,
  hasRunningClaudeSession,
  hasRunningGrokSession,
} from "./session";

/**
実環境のセッション・DB に干渉しないよう、4 エージェントすべての参照先を存在しないパスへ隔離する。
*/
function isolateAgentEnvs(): void {
  vi.stubEnv("GIT_HARVEST_CLAUDE_SESSIONS_DIR", "/nonexistent/claude-sessions");
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", "/nonexistent/state_5.sqlite");
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", "/nonexistent/antigravity");
  vi.stubEnv("GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE", "/nonexistent/active_sessions.json");
}

// session が worktree のサブディレクトリで起動されていても検出する（保護の偽陰性防止）
test("hasRunningClaudeSession detects a session started in a subdirectory", () => {
  const sessions = mkdtempSync(path.join(tmpdir(), "gh-sessions-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const sub = path.join(wt, "sub");
  mkdirSync(sub);
  writeFileSync(path.join(sessions, `${String(process.pid)}.json`), JSON.stringify({ cwd: sub }));
  vi.stubEnv("GIT_HARVEST_CLAUDE_SESSIONS_DIR", sessions);

  try {
    expect(hasRunningClaudeSession(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(sessions, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// session ファイル名が pid 形式でなくても、JSON 本文の pid で生存判定できる（命名規則は非公開・無保証）
test("hasRunningClaudeSession reads the pid from the session JSON body", () => {
  const sessions = mkdtempSync(path.join(tmpdir(), "gh-sessions-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    path.join(sessions, "session-abc.json"),
    JSON.stringify({ cwd: wt, pid: process.pid }),
  );
  vi.stubEnv("GIT_HARVEST_CLAUDE_SESSIONS_DIR", sessions);

  try {
    expect(hasRunningClaudeSession(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(sessions, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// active（未アーカイブ）な Codex thread の cwd がこの worktree 配下なら保護する
test("hasActiveCodexThread detects an active thread in a subdirectory", () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "gh-codex-db-"));
  const dbFile = path.join(dbDir, "state_5.sqlite");
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const sub = path.join(wt, "sub");
  mkdirSync(sub);
  createCodexStateDb(dbFile, [{ archived: 0, cwd: sub, id: "t1", threadSource: "user" }]);
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", dbFile);

  try {
    expect(hasActiveCodexThread(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dbDir, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// アーカイブ済みスレッドは保護しない
test("hasActiveCodexThread ignores an archived thread", () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "gh-codex-db-"));
  const dbFile = path.join(dbDir, "state_5.sqlite");
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createCodexStateDb(dbFile, [{ archived: 1, cwd: wt, id: "t1", threadSource: "user" }]);
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", dbFile);

  try {
    expect(hasActiveCodexThread(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dbDir, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// subagent スレッドは保護判定に使わない（user thread だけが有効な signal）
test("hasActiveCodexThread ignores subagent threads", () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "gh-codex-db-"));
  const dbFile = path.join(dbDir, "state_5.sqlite");
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createCodexStateDb(dbFile, [{ archived: 0, cwd: wt, id: "t1", threadSource: "subagent" }]);
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", dbFile);

  try {
    expect(hasActiveCodexThread(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dbDir, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// DB が無い・壊れている場合は保護しない（graceful fallback）
test("hasActiveCodexThread returns false when the state db is missing", () => {
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", "/nonexistent/state_5.sqlite");

  try {
    expect(hasActiveCodexThread("/some/worktree")).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

// CODEX_HOME を変えた環境では、その配下の state DB を見る
test("hasActiveCodexThread respects CODEX_HOME", () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), "gh-codex-home-"));
  const dbFile = path.join(codexHome, "state_5.sqlite");
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createCodexStateDb(dbFile, [{ archived: 0, cwd: wt, id: "t1", threadSource: "user" }]);
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", "");
  vi.stubEnv("CODEX_HOME", codexHome);

  try {
    expect(hasActiveCodexThread(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(codexHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// 複数バージョンの state DB がある場合、最新版を使う
test("hasActiveCodexThread picks the highest-versioned state db", () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), "gh-codex-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createCodexStateDb(path.join(codexHome, "state_3.sqlite"), [
    { archived: 0, cwd: wt, id: "old", threadSource: "user" },
  ]);
  createCodexStateDb(path.join(codexHome, "state_5.sqlite"), [
    { archived: 1, cwd: wt, id: "new", threadSource: "user" },
  ]);
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", "");
  vi.stubEnv("CODEX_HOME", codexHome);

  try {
    // state_5 ではアーカイブ済みなので保護しない（state_3 の古いデータは無視される）
    expect(hasActiveCodexThread(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(codexHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// agent session 保護は Claude と Codex のどちらの signal でも成立する
test("hasRunningAgentSession protects a worktree with an active codex thread", () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "gh-codex-db-"));
  const dbFile = path.join(dbDir, "state_5.sqlite");
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createCodexStateDb(dbFile, [{ archived: 0, cwd: wt, id: "t1", threadSource: "user" }]);
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", dbFile);

  try {
    expect(hasRunningAgentSession(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dbDir, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasActiveAntigravityConversation はサブディレクトリを開いた未アーカイブ会話を検出する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const sub = path.join(wt, "sub");
  mkdirSync(sub);
  createAntigravityState(agyHome, [{ archived: false, id: "conv-1", workspacePaths: [sub] }]);
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(hasActiveAntigravityConversation(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasActiveAntigravityConversation はアーカイブ済みの会話を無視する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createAntigravityState(agyHome, [{ archived: true, id: "conv-1", workspacePaths: [wt] }]);
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(hasActiveAntigravityConversation(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasActiveAntigravityConversation はサブエージェントと killed 会話を無視する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createAntigravityState(agyHome, [
    { archived: false, id: "sub-1", parentConversationId: "root-1", workspacePaths: [wt] },
    { archived: false, id: "killed-1", killed: 1, workspacePaths: [wt] },
  ]);
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(hasActiveAntigravityConversation(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasActiveAntigravityConversation は annotations が無い未アーカイブ会話も保護する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createAntigravityState(agyHome, [{ id: "conv-no-ann", workspacePaths: [wt] }]);
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(hasActiveAntigravityConversation(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasActiveAntigravityConversation は DB が無い場合に false を返す", () => {
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", "/nonexistent/antigravity");

  try {
    expect(hasActiveAntigravityConversation("/some/worktree")).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("hasActiveAntigravityConversation はタイトル内の archived: true に誤爆しない", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  createAntigravityState(agyHome, [
    {
      archived: false,
      id: "conv-title",
      title: "handle archived: true case",
      workspacePaths: [wt],
    },
  ]);
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(hasActiveAntigravityConversation(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasActiveAntigravityConversation はスペースや日本語を含む worktree パスも保護する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const base = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const wt = path.join(base, "作業 dir");
  mkdirSync(wt);
  createAntigravityState(agyHome, [{ archived: false, id: "conv-utf8", workspacePaths: [wt] }]);
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);

  try {
    expect(hasActiveAntigravityConversation(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(base, { force: true, recursive: true });
  }
});

test("hasRunningGrokSession はサブディレクトリで実行中のセッションを検出する", () => {
  const grokHome = mkdtempSync(path.join(tmpdir(), "gh-grok-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const sub = path.join(wt, "sub");
  mkdirSync(sub);
  writeFileSync(
    path.join(grokHome, "active_sessions.json"),
    JSON.stringify([{ cwd: sub, pid: process.pid, session_id: "s1" }]),
  );
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE", "");
  vi.stubEnv("GROK_HOME", grokHome);

  try {
    expect(hasRunningGrokSession(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(grokHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasRunningGrokSession は存在しない PID のセッションを無視する", () => {
  const grokHome = mkdtempSync(path.join(tmpdir(), "gh-grok-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    path.join(grokHome, "active_sessions.json"),
    JSON.stringify([{ cwd: wt, pid: 999_999_999, session_id: "s1" }]),
  );
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE", "");
  vi.stubEnv("GROK_HOME", grokHome);

  try {
    expect(hasRunningGrokSession(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(grokHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasRunningGrokSession は負の PID や null 要素を安全に無視する", () => {
  const grokHome = mkdtempSync(path.join(tmpdir(), "gh-grok-home-"));
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    path.join(grokHome, "active_sessions.json"),
    JSON.stringify([null, { cwd: wt, pid: -1 }, { cwd: wt, pid: 0 }, { cwd: wt, pid: 1.5 }]),
  );
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE", "");
  vi.stubEnv("GROK_HOME", grokHome);

  try {
    expect(hasRunningGrokSession(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(grokHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

test("hasRunningGrokSession は active_sessions.json が無い場合に false を返す", () => {
  vi.stubEnv("GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE", "/nonexistent/active_sessions.json");

  try {
    expect(hasRunningGrokSession("/some/worktree")).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("hasRunningAgentSession は Antigravity と Grok Build のセッションでも保護する", () => {
  const agyHome = mkdtempSync(path.join(tmpdir(), "gh-agy-home-"));
  const grokHome = mkdtempSync(path.join(tmpdir(), "gh-grok-home-"));
  const agyWt = mkdtempSync(path.join(tmpdir(), "gh-agy-wt-"));
  const grokWt = mkdtempSync(path.join(tmpdir(), "gh-grok-wt-"));
  createAntigravityState(agyHome, [{ archived: false, id: "conv-1", workspacePaths: [agyWt] }]);
  writeFileSync(
    path.join(grokHome, "active_sessions.json"),
    JSON.stringify([{ cwd: grokWt, pid: process.pid, session_id: "s1" }]),
  );
  isolateAgentEnvs();
  vi.stubEnv("GIT_HARVEST_ANTIGRAVITY_HOME", agyHome);
  vi.stubEnv("GIT_HARVEST_GROK_ACTIVE_SESSIONS_FILE", "");
  vi.stubEnv("GROK_HOME", grokHome);

  try {
    expect(hasRunningAgentSession(agyWt)).toBe(true);
    expect(hasRunningAgentSession(grokWt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(agyHome, { force: true, recursive: true });
    rmSync(grokHome, { force: true, recursive: true });
    rmSync(agyWt, { force: true, recursive: true });
    rmSync(grokWt, { force: true, recursive: true });
  }
});
