import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { hasActiveCodexThread, hasRunningAgentSession, hasRunningClaudeSession } from "./session";

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

function createCodexStateDb(
  dbPath: string,
  rows: { archived: number; cwd: string; id: string; threadSource: string }[],
): void {
  const db = new DatabaseSync(dbPath);

  db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, archived INTEGER, thread_source TEXT)");

  const stmt = db.prepare(
    "INSERT INTO threads (id, cwd, archived, thread_source) VALUES (?, ?, ?, ?)",
  );

  for (const row of rows) {
    stmt.run(row.id, row.cwd, row.archived, row.threadSource);
  }
  db.close();
}

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
  vi.stubEnv("GIT_HARVEST_CODEX_STATE_DB", dbFile);

  try {
    expect(hasRunningAgentSession(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(dbDir, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});
