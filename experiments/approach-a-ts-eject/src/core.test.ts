import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { cleanup, parseWorktrees } from './core';
import { eject } from './eject';

// --yolo deletes every stage, so the ejected script needs no merge detection
test('eject for --yolo omits the merge-detection helper', () => {
  expect(eject({ worktree: 'merged', yolo: true })).not.toContain('is_merged');
});

// a threshold flag still needs classification, so is_merged is emitted
test('eject for a threshold flag includes the merge-detection helper', () => {
  expect(eject({ worktree: 'committed', yolo: false })).toContain('is_merged()');
});

// porcelain parse keeps paths containing spaces (slice, not awk $2)
test('parseWorktrees preserves a worktree path that contains a space', () => {
  const parsed = parseWorktrees('worktree /tmp/my repo/wt\nbranch refs/heads/feat\n');

  expect(parsed[0]).toStrictEqual({ branch: 'feat', path: '/tmp/my repo/wt' });
});

// default removes a squash-merged branch and keeps an unmerged one
test('cleanup deletes a merged branch and keeps an open one', async () => {
  using fx = makeRepo();

  const removed = await cleanup({ worktree: 'merged', yolo: false }, fx.repo);

  expect(removed.some((l) => l.includes('feat-merged'))).toBe(true);
  expect(fx.branches()).toContain('feat-open');
  expect(fx.branches()).not.toContain('feat-merged');
});

// fixture: origin + clone, one squash-merged branch and one open branch
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'gh-a-'));
  const origin = join(dir, 'origin.git');
  const repo = join(dir, 'repo');
  const g = (args: string[], cwd: string): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

  execFileSync('git', ['init', '-q', '--bare', origin], { stdio: 'pipe' });
  execFileSync('git', ['clone', '-q', origin, repo], { stdio: 'pipe' });
  g(['config', 'user.email', 't@t.t'], repo);
  g(['config', 'user.name', 't'], repo);
  g(['config', 'commit.gpgsign', 'false'], repo);
  g(['commit', '-q', '--allow-empty', '-m', 'init'], repo);
  g(['push', '-q', 'origin', 'HEAD:main'], repo);
  g(['remote', 'set-head', 'origin', 'main'], repo);
  g(['branch', '-m', 'main'], repo);
  g(['checkout', '-q', '-b', 'feat-merged'], repo);
  g(['commit', '-q', '--allow-empty', '-m', 'work'], repo);
  g(['checkout', '-q', 'main'], repo);
  g(['merge', '-q', '--squash', 'feat-merged'], repo);
  g(['commit', '-q', '--allow-empty', '-m', 'squash'], repo);
  g(['checkout', '-q', '-b', 'feat-open'], repo);
  g(['commit', '-q', '--allow-empty', '-m', 'open'], repo);
  g(['checkout', '-q', 'main'], repo);

  return {
    repo,
    branches: (): string[] =>
      g(['branch', '--format=%(refname:short)'], repo).split('\n').map((b) => b.trim()).filter(Boolean),
    [Symbol.dispose]() {
      rmSync(dir, { force: true, recursive: true });
    },
  };
}
