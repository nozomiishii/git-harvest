import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { hasRunningClaudeSession, isClaudeManagedWorktree } from "./claude";
import { makeSessionsDir, makeTempDir } from "./test-helpers";

// <pid>.json セッションファイルを sessions ディレクトリに書き出す
function writeSession(dir: string, pid: number, cwd: string): void {
  writeFileSync(path.join(dir, `${String(pid)}.json`), JSON.stringify({ cwd, pid }));
}

// cwd 一致かつ pid 生存（自プロセス）なら true
test("hasRunningClaudeSession returns true when a session with a live pid matches the worktree", async () => {
  using sessions = makeSessionsDir();
  using wt = makeTempDir();
  writeSession(sessions.path, process.pid, wt.path);

  expect(await hasRunningClaudeSession(wt.path)).toBe(true);
});

// cwd 一致でも pid が死亡していれば false
test("hasRunningClaudeSession returns false when the matching session pid is dead", async () => {
  using sessions = makeSessionsDir();
  using wt = makeTempDir();
  // 到達しにくい大きな pid を死亡 pid として使う
  writeSession(sessions.path, 2_147_483_646, wt.path);

  expect(await hasRunningClaudeSession(wt.path)).toBe(false);
});

// どの session も cwd 一致しなければ false
test("hasRunningClaudeSession returns false when no session matches the worktree", async () => {
  using sessions = makeSessionsDir();
  using wt = makeTempDir();
  using other = makeTempDir();
  writeSession(sessions.path, process.pid, other.path);

  expect(await hasRunningClaudeSession(wt.path)).toBe(false);
});

// sessions ディレクトリが空なら false
test("hasRunningClaudeSession returns false when sessions dir has no session files", async () => {
  using sessions = makeSessionsDir();
  using wt = makeTempDir();
  void sessions.path;

  expect(await hasRunningClaudeSession(wt.path)).toBe(false);
});

// .claude/worktrees/<name> 配下は managed
test("isClaudeManagedWorktree returns true for a path under .claude/worktrees/<name>", () => {
  expect(isClaudeManagedWorktree("/repo/.claude/worktrees/my-feature")).toBe(true);
});

// さらに深い階層でも managed
test("isClaudeManagedWorktree returns true for a nested path under .claude/worktrees/<name>", () => {
  expect(isClaudeManagedWorktree("/repo/.claude/worktrees/my-feature/sub")).toBe(true);
});

// .claude/worktrees ディレクトリ自体は managed ではない
test("isClaudeManagedWorktree returns false for the .claude/worktrees dir itself", () => {
  expect(isClaudeManagedWorktree("/repo/.claude/worktrees")).toBe(false);
});

// 末尾スラッシュのみ（名前なし）も managed ではない
test("isClaudeManagedWorktree returns false for .claude/worktrees with only a trailing slash", () => {
  expect(isClaudeManagedWorktree("/repo/.claude/worktrees/")).toBe(false);
});

// 無関係なパスは managed ではない
test("isClaudeManagedWorktree returns false for an unrelated path", () => {
  expect(isClaudeManagedWorktree("/repo/some/worktree")).toBe(false);
});
