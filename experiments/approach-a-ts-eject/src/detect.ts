import { gitOk, gitText } from './git';

// merged = real merge (ancestor) OR squash (virtual squash commit + git cherry).
// Pure async function over git -> trivially unit-testable against fixture repos.
export async function isMerged(base: string, ref: string, cwd?: string): Promise<boolean> {
  if (await gitOk(['merge-base', '--is-ancestor', ref, base], cwd)) return true;

  let mergeBase: string;

  try {
    mergeBase = await gitText(['merge-base', base, ref], cwd);
  } catch {
    return false;
  }

  let squash: string;

  try {
    squash = await gitText(['commit-tree', `${ref}^{tree}`, '-p', mergeBase, '-m', '_'], cwd);
  } catch {
    return false;
  }

  let cherry: string;

  try {
    cherry = await gitText(['cherry', base, squash], cwd);
  } catch {
    return false;
  }

  return !cherry.split('\n').some((line) => line.startsWith('+'));
}
