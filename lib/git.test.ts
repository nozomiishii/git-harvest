import { ExecaError } from 'execa';
import { expect, test } from 'vitest';
import { git, gitExitOk, gitText } from './git';
import { makeSimpleRepo } from './test-helpers';

// gitText は stdout を trim して返す
test('gitText returns trimmed stdout', async () => {
  using r = makeSimpleRepo();

  const branch = await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: r.path });

  expect(branch).toBe('main');
});

// git は成功時 resolve し exitCode 0 を返す
test('git resolves on success', async () => {
  using r = makeSimpleRepo();

  const result = await git(['rev-parse', 'HEAD'], { cwd: r.path });

  expect(result.exitCode).toBe(0);
});

// git は失敗時に ExecaError で reject する
test('git rejects on failure', async () => {
  using r = makeSimpleRepo();

  await expect(
    git(['rev-parse', '--verify', 'nonexistent-branch'], { cwd: r.path }),
  ).rejects.toThrow(ExecaError);
});

// gitExitOk は終了コード 0 で true を返す
test('gitExitOk returns true on success', async () => {
  using r = makeSimpleRepo();

  expect(await gitExitOk(['rev-parse', '--verify', 'HEAD'], { cwd: r.path })).toBe(true);
});

// gitExitOk は非ゼロ終了でも reject せず false を返す
test('gitExitOk returns false on non-zero exit', async () => {
  using r = makeSimpleRepo();

  expect(await gitExitOk(['rev-parse', '--verify', 'nonexistent-branch'], { cwd: r.path })).toBe(false);
});
