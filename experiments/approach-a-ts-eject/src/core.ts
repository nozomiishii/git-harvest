import { realpathSync } from 'node:fs';
import { isMerged } from './detect';
import { gitOk, gitText } from './git';

// The flag state is data (a threshold + the yolo bundle), exactly like the real
// tool. The decision logic below reads it; flags never branch the code.
export type Flags = {
  worktree: 'committed' | 'merged'; // worktree deletion threshold
  yolo: boolean;
};

type Worktree = { branch: null | string; path: string };

// Source of truth. Runs entirely in TS; eject.ts emits a shell version of this.
export async function cleanup(flags: Flags, cwd?: string): Promise<string[]> {
  const base = await resolveBase(cwd);
  const out: string[] = [];

  const entries = parseWorktrees(await gitText(['worktree', 'list', '--porcelain'], cwd));
  const mainPath = entries[0]?.path;
  const current = canon(await gitText(['rev-parse', '--show-toplevel'], cwd));

  for (const [i, wt] of entries.entries()) {
    if (i === 0 || wt.path === mainPath && i === 0) continue; // main worktree
    if (canon(wt.path) === current) continue; // current cwd
    if (wt.branch === base) continue; // base branch worktree

    if (flags.yolo) {
      if (await gitOk(['worktree', 'remove', '--force', wt.path], cwd)) out.push(`removed worktree: ${wt.path}`);
      continue;
    }
    if (!wt.branch) continue; // detached: kept in this prototype

    if (await isMerged(base, wt.branch, cwd)) {
      if (await gitOk(['worktree', 'remove', wt.path], cwd)) out.push(`removed worktree: ${wt.path}`);
    } else if (flags.worktree === 'committed') {
      if (await gitOk(['worktree', 'remove', '--force', wt.path], cwd)) out.push(`removed worktree: ${wt.path}`);
    }
  }

  const currentHead = await gitText(['symbolic-ref', '--short', 'HEAD'], cwd).catch(() => '');
  const branches = (await gitText(['branch', '--format=%(refname:short)'], cwd))
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);

  for (const branch of branches) {
    if (branch === base || branch === currentHead) continue;

    if (flags.yolo || (await isMerged(base, branch, cwd))) {
      if (await gitOk(['branch', '-D', branch], cwd)) out.push(`removed branch: ${branch}`);
    }
  }

  return out;
}

// origin/HEAD -> default branch.
export async function resolveBase(cwd?: string): Promise<string> {
  const ref = await gitText(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);

  return ref.replace(/^refs\/remotes\/origin\//, '');
}

// Porcelain parse via slice() (not awk $2), so paths with spaces survive and
// the parser is unit-testable on plain strings.
export function parseWorktrees(porcelain: string): Worktree[] {
  const list: Worktree[] = [];
  let current: null | Worktree = null;

  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) list.push(current);
      current = { branch: null, path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  if (current) list.push(current);

  return list;
}

function canon(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
