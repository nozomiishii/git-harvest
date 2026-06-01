import { execa } from 'execa';

export type GitOptions = {
  // git を実行するディレクトリ。省略時はカレント。
  cwd?: string;
};

// git を実行する。非ゼロ終了で reject する（execa のデフォルト挙動）。
// async でラップしてネイティブ Promise を返す（execa の ResultPromise を漏らさない）。
export async function git(args: string[], options: GitOptions = {}) {
  return execa('git', args, { cwd: options.cwd });
}

// git の終了コードが 0 か否かだけ返す。判定用なので reject しない。
export async function gitExitOk(args: string[], options: GitOptions = {}): Promise<boolean> {
  const { exitCode } = await execa('git', args, { cwd: options.cwd, reject: false });

  return exitCode === 0;
}

// git の stdout を前後の空白を落として返す。非ゼロ終了で reject する。
export async function gitText(args: string[], options: GitOptions = {}): Promise<string> {
  const { stdout } = await execa('git', args, { cwd: options.cwd });

  return stdout.trim();
}
