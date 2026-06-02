import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Thin git wrapper. The TS layer owns execution; this is what makes the logic
// unit-testable (callers are plain async functions, not shell).
export async function gitText(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  return stdout.trim();
}

// Run a git command for its exit status only (never throws).
export async function gitOk(args: string[], cwd?: string): Promise<boolean> {
  try {
    await run('git', args, { cwd });

    return true;
  } catch {
    return false;
  }
}
