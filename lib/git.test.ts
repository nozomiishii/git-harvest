import { expect, test } from 'vitest';
import { git, gitExitOk, gitText } from './git';
import { makeSimpleRepo } from './test-helpers';

// gitText は stdout を trim して返す
test('gitText returns trimmed stdout', async () => {
  using r = makeSimpleRepo();

  const branch = await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: r.path });

  expect(branch).toBe('main');
});

// git は成功時 resolve し stdout を文字列で返す
test('git resolves on success', async () => {
  using r = makeSimpleRepo();

  const result = await git(['rev-parse', 'HEAD'], { cwd: r.path });

  expect(result.stdout).toBeTypeOf('string');
});

// git は失敗時に stderr テキストを message に含む GitError で reject する（TRAP 2 ロック）
test('git rejects on failure with stderr in message', async () => {
  using r = makeSimpleRepo();

  await expect(
    git(['rev-parse', '--verify', 'nonexistent-branch'], { cwd: r.path }),
  ).rejects.toThrow(/not a git repository|fatal/i);
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
