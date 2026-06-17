import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { hasRunningAgentSession, hasRunningClaudeSession, hasRunningCodexProcess } from "./session";

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

// Codex app の process manager が worktree 配下の生きた OS pid を持つ場合は保護する
test("hasRunningCodexProcess detects a live osPid started in a subdirectory", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const sub = path.join(wt, "sub");
  mkdirSync(sub);
  writeFileSync(processes, JSON.stringify([{ cwd: sub, osPid: String(process.pid) }]));
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// processId は Codex app 内部 ID なので、OS pid としては扱わない
test("hasRunningCodexProcess ignores processId without a live osPid or fresh timestamp", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(processes, JSON.stringify([{ cwd: wt, processId: String(process.pid) }]));
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// 最近更新された Codex process entry は active signal として保護する
test("hasRunningCodexProcess detects a recently updated codex process entry", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    processes,
    JSON.stringify([{ cwd: wt, processId: "codex-turn", updatedAtMs: Date.now() }]),
  );
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// Codex app の fresh entry は processId が null でも active signal として保護する
test("hasRunningCodexProcess detects a recently updated codex entry without processId", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    processes,
    JSON.stringify([
      { cwd: wt, id: "codex-process", processId: null, turnId: "turn", updatedAtMs: Date.now() },
    ]),
  );
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// 更新時刻が古い Codex process entry は stale として保護扱いしない
test("hasRunningCodexProcess ignores stale codex process entries", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
  writeFileSync(
    processes,
    JSON.stringify([{ cwd: wt, processId: "codex-turn", updatedAtMs: twoDaysAgo }]),
  );
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// CODEX_HOME を変えた環境では、その配下の process manager を見る
test("hasRunningCodexProcess respects CODEX_HOME", () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), "gh-codex-home-"));
  const processManager = path.join(codexHome, "process_manager");
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  mkdirSync(processManager);
  writeFileSync(
    path.join(processManager, "chat_processes.json"),
    JSON.stringify([{ cwd: wt, osPid: String(process.pid) }]),
  );
  vi.stubEnv("CODEX_HOME", codexHome);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(codexHome, { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// 想定外に大きい Codex state は読まず、内部情報の広い読み取りを避ける
test("hasRunningCodexProcess ignores an oversized process manager file", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    processes,
    JSON.stringify([{ cwd: wt, padding: "x".repeat(1_100_000), processId: "codex-turn" }]),
  );
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningCodexProcess(wt)).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});

// agent session 保護は Claude と Codex のどちらの実行中 signal でも成立する
test("hasRunningAgentSession protects a worktree with a live codex process", () => {
  const processes = path.join(
    mkdtempSync(path.join(tmpdir(), "gh-codex-processes-")),
    "chat_processes.json",
  );
  const wt = mkdtempSync(path.join(tmpdir(), "gh-wt-"));
  writeFileSync(
    processes,
    JSON.stringify([{ cwd: wt, processId: "codex-turn", updatedAtMs: Date.now() }]),
  );
  vi.stubEnv("GIT_HARVEST_CODEX_PROCESS_MANAGER_FILE", processes);

  try {
    expect(hasRunningAgentSession(wt)).toBe(true);
  } finally {
    vi.unstubAllEnvs();
    rmSync(path.dirname(processes), { force: true, recursive: true });
    rmSync(wt, { force: true, recursive: true });
  }
});
