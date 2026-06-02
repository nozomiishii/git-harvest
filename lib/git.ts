import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type GitOptions = {
  // git を実行するディレクトリ。省略時はカレント。
  cwd?: string | undefined;
};

const execFileAsync = promisify(execFile);

// git 実行失敗時にスローする。stderr を message に含め、worktree/branch の
// regex マッチ（isStaleRemoveError / isAlreadyGoneError）が正しく動くようにする。
export class GitError extends Error {
  readonly code: null | number;
  readonly stderr: string;
  readonly stdout: string;

  constructor(stderr: string, stdout: string, code: null | number, fallback: string) {
    super(stderr.trim() || fallback);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

// git を実行する。非ゼロ終了で GitError を throw する。
// maxBuffer を 64MB に設定: rev-list / git log / git cherry は大規模リポジトリで
// デフォルト 1MB を超えることがあるため。
export async function git(args: string[], options: GitOptions = {}) {
  try {
    return await execFileAsync('git', args, {
      ...cwdOption(options),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const { code, stderr, stdout } = extractGitError(error);
    const message = error instanceof Error && error.message ? error.message : 'git command failed';

    throw new GitError(stderr, stdout, code, message);
  }
}

// git の終了コードが 0 か否かだけ返す。判定用なので reject しない。
export async function gitExitOk(args: string[], options: GitOptions = {}): Promise<boolean> {
  try {
    await git(args, options);

    return true;
  } catch {
    return false;
  }
}

// git の stdout を前後の空白を落として返す。非ゼロ終了で GitError を throw する。
export async function gitText(args: string[], options: GitOptions = {}): Promise<string> {
  const result = await git(args, options);

  return result.stdout.trim();
}

// execFile の cwd は exactOptionalPropertyTypes 下で undefined を受け付けない。
// cwd 未指定時はキー自体を渡さず「省略」に倒す。
function cwdOption(options: GitOptions): { cwd?: string } {
  return options.cwd === undefined ? {} : { cwd: options.cwd };
}

// execFile の reject エラーから GitError 用のフィールド（stderr / stdout / code）を取り出す。
// execFile は失敗時 code を string（ENOENT 等）で持つことがあるため、number のときだけ採用する。
function extractGitError(error: unknown): { code: null | number; stderr: string; stdout: string } {
  const e = error as { code?: number | string; stderr?: string; stdout?: string };

  return {
    code: typeof e.code === 'number' ? e.code : null,
    stderr: typeof e.stderr === 'string' ? e.stderr : '',
    stdout: typeof e.stdout === 'string' ? e.stdout : '',
  };
}
