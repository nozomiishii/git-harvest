import { execa } from 'execa';

export type GitOptions = {
  // git を実行するディレクトリ。省略時はカレント。
  cwd?: string | undefined;
};

// git を実行する。非ゼロ終了で reject する（execa のデフォルト挙動）。
// async でラップしてネイティブ Promise を返す（execa の ResultPromise を漏らさない）。
export async function git(args: string[], options: GitOptions = {}) {
  return execa('git', args, cwdOption(options));
}

// git の終了コードが 0 か否かだけ返す。判定用なので reject しない。
export async function gitExitOk(args: string[], options: GitOptions = {}): Promise<boolean> {
  const { exitCode } = await execa('git', args, { ...cwdOption(options), reject: false });

  return exitCode === 0;
}

// git の stdout を前後の空白を落として返す。非ゼロ終了で reject する。
export async function gitText(args: string[], options: GitOptions = {}): Promise<string> {
  const { stdout } = await execa('git', args, cwdOption(options));

  return stdout.trim();
}

// execa の cwd は exactOptionalPropertyTypes 下で undefined を受け付けない。
// cwd 未指定時はキー自体を渡さず「省略」に倒す。
function cwdOption(options: GitOptions): { cwd?: string } {
  return options.cwd === undefined ? {} : { cwd: options.cwd };
}
