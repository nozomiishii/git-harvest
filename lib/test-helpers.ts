import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// origin（bare）付きリポジトリ。main に init コミットを push 済み。
// dispose で全 worktree を unlock + force remove してから repo / bare を削除する。
export type OriginRepo = Disposable & { bare: string; path: string };

// Claude sessions ディレクトリを空の temp に向け、dispose で env を戻し temp を削除する
export type SessionsDir = Disposable & { path: string };

// main + 空コミット 1 個の最小リポジトリ（origin 無し）。dispose で削除する。
export type TempRepo = Disposable & { path: string };

// null/undefined を弾いて値を型 narrow して返す（テストで非 null 表明 ! を使わないため）
export function assertDefined<T>(value: null | T | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected value to be defined');
  }

  return value;
}

// ファイルを書いて 1 コミットする
export function commitFile(cwd: string, filename: string, message: string): void {
  writeFileSync(path.join(cwd, filename), `${filename}: ${message}\n`);
  tgit(cwd, `add ${filename}`);
  tgit(cwd, `commit -m "${message}"`);
}

export function makeOriginRepo(): OriginRepo {
  const bare = mkdtempSync(path.join(tmpdir(), 'git-harvest-bare-'));
  execSync(`git init --bare -b main ${bare}`);
  const repo = mkdtempSync(path.join(tmpdir(), 'git-harvest-work-'));
  execSync(`git clone ${bare} ${repo}`);
  commitFile(repo, 'README.md', 'init');
  tgit(repo, 'push');

  return {
    bare,
    path: repo,
    [Symbol.dispose]() {
      try {
        for (const wt of listWorktrees(repo)) {
          if (wt === repo) {
            continue;
          }

          try {
            tgit(repo, `worktree unlock ${wt}`);
          } catch {
            // lock されていなければ無視
          }

          try {
            tgit(repo, `worktree remove --force --force ${wt}`);
          } catch {
            // すでに無ければ無視
          }
        }
      } catch {
        // worktree list 自体が失敗しても repo / bare の削除は続行する
      }

      rmSync(repo, { force: true, recursive: true });
      rmSync(bare, { force: true, recursive: true });
    },
  };
}

export function makeSessionsDir(): SessionsDir {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-harvest-sessions-'));
  const saved = process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR;
  process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR = dir;

  return {
    path: dir,
    [Symbol.dispose]() {
      if (saved === undefined) {
        delete process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR;
      } else {
        process.env.GIT_HARVEST_CLAUDE_SESSIONS_DIR = saved;
      }

      rmSync(dir, { force: true, recursive: true });
    },
  };
}

export function makeSimpleRepo(): TempRepo {
  const repo = mkdtempSync(path.join(tmpdir(), 'git-harvest-git-'));
  execSync('git init -b main', { cwd: repo });
  tgit(repo, 'commit --allow-empty -m init');

  return {
    path: repo,
    [Symbol.dispose]() {
      rmSync(repo, { force: true, recursive: true });
    },
  };
}

// 空の temp ディレクトリ（git リポジトリではない）。dispose で削除する。
export function makeTempDir(): TempRepo {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-harvest-tmp-'));

  return {
    path: dir,
    [Symbol.dispose]() {
      rmSync(dir, { force: true, recursive: true });
    },
  };
}

// 署名と user identity を固定してテスト用 git を実行し、stdout を返す
export function tgit(cwd: string, args: string): string {
  return execSync(
    `git -c user.email=test@test.com -c user.name=Test -c commit.gpgsign=false ${args}`,
    { cwd, encoding: 'utf8', stdio: 'pipe' },
  );
}

// NO_COLOR を一時設定し、dispose で元の値に戻す（着色挙動を env で固定するため）
export function withNoColor(value: string | undefined): Disposable {
  const saved = process.env.NO_COLOR;

  if (value === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = value;
  }

  return {
    [Symbol.dispose]() {
      if (saved === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = saved;
      }
    },
  };
}

// `git worktree list --porcelain` から worktree path 一覧を取り出す
function listWorktrees(cwd: string): string[] {
  return execSync('git worktree list --porcelain', { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.replace('worktree ', ''));
}
