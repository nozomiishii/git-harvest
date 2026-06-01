import { realpathSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

// この worktree で走行中の Claude session があるか。
// bash の has_running_claude_session + claude_sessions_dir を移植。
//   sessions ディレクトリ内の各 <pid>.json を読み、cwd を canonical 化して worktree と一致し、
//   pid が生存（process.kill(pid, 0) が投げない）なら true。
export async function hasRunningClaudeSession(worktreePath: string): Promise<boolean> {
  const dir = claudeSessionsDir();

  // ディレクトリが無ければセッションなし。
  try {
    const dirStat = await stat(dir);

    if (!dirStat.isDirectory()) return false;
  } catch {
    return false;
  }

  const worktreeCanon = canonicalPath(worktreePath);

  if (!worktreeCanon) return false;

  let entries: string[];

  try {
    const names = await readdir(dir);

    entries = names.filter((name) => name.endsWith('.json'));
  } catch {
    return false;
  }

  for (const name of entries) {
    const file = path.join(dir, name);

    let raw: string;

    try {
      const fileStat = await stat(file);

      if (!fileStat.isFile()) continue;
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    // JSON は通常 single-line だが pretty-print にも備えて key/value 間の空白を許容する。
    const cwdMatch = /"cwd"\s*:\s*"([^"]*)"/.exec(raw);
    const cwd = cwdMatch?.[1];

    if (!cwd) continue;

    if (canonicalPath(cwd) !== worktreeCanon) continue;

    const pidMatch = /"pid"\s*:\s*(\d+)/.exec(raw);
    const pid = pidMatch?.[1];

    if (!pid) continue;

    // process.kill(pid, 0) は実際にはシグナルを送らず生存確認のみ。投げなければ生存。
    try {
      process.kill(Number(pid), 0);

      return true;
    } catch {
      // プロセス不在（ESRCH）など。死亡とみなして次の session を見る。
    }
  }

  return false;
}

// worktree が Claude Code 管理下のパス（.claude/worktrees/<name>）配下にあるか。
// bash の is_claude_managed_worktree（glob `*/.claude/worktrees/?*`）を移植。
// 末尾に最低1文字を要求し、`.claude/worktrees` や `.claude/worktrees/` 自体は false。
export function isClaudeManagedWorktree(worktreePath: string): boolean {
  const marker = '/.claude/worktrees/';
  const index = worktreePath.indexOf(marker);

  if (index === -1) return false;

  // marker 直後に最低1文字あること（`?*` 相当）。
  return worktreePath.length > index + marker.length;
}

// パスを canonical（symlink 解決済み）に正規化する。
// git は worktree path を canonical で保持するが、JSON 内の cwd はユーザー指定のまま
// 記録されうるため両者を揃える。例: macOS の /var/folders は /private/var/folders。
// 解決できないパスは原文のまま返す。
function canonicalPath(p: string): string {
  if (!p) return p;

  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// Claude CLI が走行中セッションを記録するディレクトリ。
// 上書き用 env: GIT_HARVEST_CLAUDE_SESSIONS_DIR（テスト / power user 用）。既定は ~/.claude/sessions。
function claudeSessionsDir(): string {
  return process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR ?? path.join(homedir(), '.claude', 'sessions');
}
