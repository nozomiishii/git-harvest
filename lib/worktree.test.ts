import { execSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { Flags } from './types';
import { assertDefined, commitFile, makeOriginRepo, makeSessionsDir, tgit } from './test-helpers';
import {
  cleanupWorktrees,
  collectWorktrees,
  shouldDeleteWorktree,
  worktreeStage,
} from './worktree';

// merged かつ clean な worktree を作るヘルパー（branch は squash merge 済み）
function addMergedWorktree(repo: string, branch: string, dirName: string): string {
  tgit(repo, `checkout -b ${branch}`);
  commitFile(repo, `${branch}.txt`, 'work');
  tgit(repo, 'checkout main');
  tgit(repo, `merge --squash ${branch}`);
  tgit(repo, `commit -m "squash ${branch}"`);
  tgit(repo, 'push');
  const dir = path.join(repo, '..', dirName);
  tgit(repo, `worktree add ${dir} ${branch}`);

  return dir;
}

// default flags（全 scope merged・detached/untouched は保護・dryRun off）
function defaultFlags(overrides: Partial<Flags> = {}): Flags {
  return {
    branch: 'merged',
    claudeWorktree: 'merged',
    claudeWorktreeDetached: false,
    claudeWorktreeUntouched: false,
    dryRun: false,
    worktree: 'merged',
    worktreeDetached: false,
    worktreeUntouched: false,
    ...overrides,
  };
}

// 指定 branch の WorktreeInfo を収集結果から探す
async function infoForBranch(repo: string, branch: string) {
  const infos = await collectWorktrees('main', repo);

  return infos.find((wt) => wt.branch === branch);
}

// worktree path 一覧を取得する
function worktreePaths(cwd: string): string[] {
  return execSync('git worktree list --porcelain', { cwd, encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.replace('worktree ', ''));
}

// 未コミット変更があれば branch が merged でも files-changed が優先
test('worktreeStage returns files-changed when uncommitted changes exist even if merged', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = addMergedWorktree(r.path, 'stage-dirty', 'stage-dirty-dir');
  writeFileSync(path.join(dir, 'dirty.txt'), 'dirty\n');
  const wt = assertDefined(await infoForBranch(r.path, 'stage-dirty'));

  expect(worktreeStage(wt)).toBe('files-changed');
});

// merged かつ clean なら merged
test('worktreeStage returns merged for a clean merged worktree', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  addMergedWorktree(r.path, 'stage-merged', 'stage-merged-dir');
  const wt = assertDefined(await infoForBranch(r.path, 'stage-merged'));

  expect(worktreeStage(wt)).toBe('merged');
});

// 未マージの独自コミットを持つ clean worktree は committed
test('worktreeStage returns committed for a clean unmerged worktree', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  tgit(r.path, 'checkout -b stage-committed');
  commitFile(r.path, 'committed.txt', 'work');
  tgit(r.path, 'checkout main');
  const dir = path.join(r.path, '..', 'stage-committed-dir');
  tgit(r.path, `worktree add ${dir} stage-committed`);
  const wt = assertDefined(await infoForBranch(r.path, 'stage-committed'));

  expect(worktreeStage(wt)).toBe('committed');
});

// main worktree は最強 flag でも消えない
test('shouldDeleteWorktree never deletes the main worktree', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const infos = await collectWorktrees('main', r.path);
  const main = assertDefined(infos.find((wt) => wt.isMain));
  const yolo = defaultFlags({
    claudeWorktree: 'files-changed',
    claudeWorktreeDetached: true,
    claudeWorktreeUntouched: true,
    worktree: 'files-changed',
    worktreeDetached: true,
    worktreeUntouched: true,
  });

  expect(shouldDeleteWorktree(main, yolo)).toBe(false);
});

// カレント worktree は消えない（cwd をその worktree に向ける）
test('shouldDeleteWorktree never deletes the current worktree', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = addMergedWorktree(r.path, 'inv-current', 'inv-current-dir');
  // cwd を当該 worktree にして収集すると isCurrent=true になる
  const infos = await collectWorktrees('main', dir);
  const wt = assertDefined(infos.find((w) => w.branch === 'inv-current'));

  expect(wt.isCurrent).toBe(true);
  expect(shouldDeleteWorktree(wt, defaultFlags({ worktree: 'files-changed' }))).toBe(false);
});

// locked worktree は yolo でも消えない
test('shouldDeleteWorktree never deletes a locked worktree', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = addMergedWorktree(r.path, 'inv-locked', 'inv-locked-dir');
  tgit(r.path, `worktree lock ${dir}`);
  const wt = assertDefined(await infoForBranch(r.path, 'inv-locked'));

  expect(wt.locked).toBe(true);
  expect(shouldDeleteWorktree(wt, defaultFlags({ worktree: 'files-changed' }))).toBe(false);

  tgit(r.path, `worktree unlock ${dir}`);
});

// 走行中 session のある worktree は消えない
test('shouldDeleteWorktree never deletes a worktree with a running claude session', async () => {
  using r = makeOriginRepo();
  using s = makeSessionsDir();
  const dir = addMergedWorktree(r.path, 'inv-session', 'inv-session-dir');
  const sleepProc = spawn('sleep', ['60'], { detached: false });

  try {
    writeFileSync(
      path.join(s.path, `${String(sleepProc.pid)}.json`),
      JSON.stringify({ cwd: dir, pid: sleepProc.pid, status: 'busy' }),
    );
    const wt = assertDefined(await infoForBranch(r.path, 'inv-session'));

    expect(wt.sessionRunning).toBe(true);
    expect(shouldDeleteWorktree(wt, defaultFlags({ worktree: 'files-changed' }))).toBe(false);
  } finally {
    sleepProc.kill('SIGKILL');
  }
});

// detached worktree は default 保護、worktreeDetached=true で削除
test('shouldDeleteWorktree keeps detached worktree by default but deletes it with the detached flag', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = path.join(r.path, '..', 'detached-dir');
  tgit(r.path, `worktree add --detach ${dir} HEAD`);
  const infos = await collectWorktrees('main', r.path);
  const wt = assertDefined(infos.find((w) => w.path !== r.path && w.branch === null));

  expect(shouldDeleteWorktree(wt, defaultFlags())).toBe(false);
  expect(shouldDeleteWorktree(wt, defaultFlags({ worktreeDetached: true }))).toBe(true);
});

// untouched worktree は default 保護、worktreeUntouched=true で削除
test('shouldDeleteWorktree keeps untouched worktree by default but deletes it with the untouched flag', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = path.join(r.path, '..', 'untouched-dir');
  tgit(r.path, `worktree add ${dir} -b untouched-br`);
  const wt = assertDefined(await infoForBranch(r.path, 'untouched-br'));

  expect(wt.classification).toBe('untouched');
  expect(shouldDeleteWorktree(wt, defaultFlags())).toBe(false);
  expect(shouldDeleteWorktree(wt, defaultFlags({ worktreeUntouched: true }))).toBe(true);
});

// merged かつ clean は default で削除
test('shouldDeleteWorktree deletes a clean merged worktree by default', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  addMergedWorktree(r.path, 'del-merged', 'del-merged-dir');
  const wt = assertDefined(await infoForBranch(r.path, 'del-merged'));

  expect(shouldDeleteWorktree(wt, defaultFlags())).toBe(true);
});

// merged を編集して dirty にすると files-changed 扱いで default では消えない
test('shouldDeleteWorktree keeps a merged worktree turned dirty under the default threshold', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = addMergedWorktree(r.path, 'del-merged-dirty', 'del-merged-dirty-dir');
  writeFileSync(path.join(dir, 'edit.txt'), 'now dirty\n');
  const wt = assertDefined(await infoForBranch(r.path, 'del-merged-dirty'));

  expect(worktreeStage(wt)).toBe('files-changed');
  expect(shouldDeleteWorktree(wt, defaultFlags())).toBe(false);
  // files-changed 閾値なら消える
  expect(shouldDeleteWorktree(wt, defaultFlags({ worktree: 'files-changed' }))).toBe(true);
});

// claude 閾値は通常 path worktree を触らない（scope 分離）
test('shouldDeleteWorktree claude threshold does not touch a normal-path worktree', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  tgit(r.path, 'checkout -b scope-normal');
  commitFile(r.path, 'scope.txt', 'work');
  tgit(r.path, 'checkout main');
  const dir = path.join(r.path, '..', 'scope-normal-dir');
  tgit(r.path, `worktree add ${dir} scope-normal`);
  const wt = assertDefined(await infoForBranch(r.path, 'scope-normal'));

  expect(wt.isClaudeManaged).toBe(false);
  // claudeWorktree を最危険にしても通常 path は閾値 merged のまま消えない
  expect(shouldDeleteWorktree(wt, defaultFlags({ claudeWorktree: 'files-changed' }))).toBe(false);
});

// git は path を canonical で返すため、basename で照合する
// merged worktree を実削除し、survivingPaths から外す
test('cleanupWorktrees removes a merged worktree and excludes it from survivingPaths', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  addMergedWorktree(r.path, 'cleanup-merged', 'cleanup-merged-dir');
  const result = await cleanupWorktrees('main', defaultFlags(), r.path);

  expect(result.failures).toBe(0);
  expect(
    result.results.some((res) => res.name.endsWith('cleanup-merged-dir') && res.action === 'removed'),
  ).toBe(true);
  expect(result.survivingPaths.some((p) => p.endsWith('cleanup-merged-dir'))).toBe(false);
  expect(worktreePaths(r.path)).toHaveLength(1);
});

// dryRun では削除せず would-remove を返し、survivingPaths から外す
test('cleanupWorktrees dry-run reports would-remove without deleting', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  const dir = addMergedWorktree(r.path, 'cleanup-dry', 'cleanup-dry-dir');
  const result = await cleanupWorktrees('main', defaultFlags({ dryRun: true }), r.path);

  expect(
    result.results.some((res) => res.name.endsWith('cleanup-dry-dir') && res.action === 'would-remove'),
  ).toBe(true);
  expect(result.survivingPaths.some((p) => p.endsWith('cleanup-dry-dir'))).toBe(false);
  expect(worktreePaths(r.path)).toHaveLength(2);

  tgit(r.path, `worktree remove ${dir}`);
});

// 未マージ worktree は kept（committed 理由）で survivingPaths に残す
test('cleanupWorktrees keeps an unmerged worktree in survivingPaths', async () => {
  using r = makeOriginRepo();
  using _ = makeSessionsDir();
  tgit(r.path, 'checkout -b cleanup-keep');
  commitFile(r.path, 'keep.txt', 'work');
  tgit(r.path, 'checkout main');
  const dir = path.join(r.path, '..', 'cleanup-keep-dir');
  tgit(r.path, `worktree add ${dir} cleanup-keep`);
  const result = await cleanupWorktrees('main', defaultFlags(), r.path);
  const kept = assertDefined(result.results.find((res) => res.name.endsWith('cleanup-keep-dir')));

  expect(kept.action).toBe('kept');
  expect(result.survivingPaths.some((p) => p.endsWith('cleanup-keep-dir'))).toBe(true);

  tgit(r.path, `worktree remove ${dir}`);
});
