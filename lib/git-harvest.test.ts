import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

const SCRIPT = join(import.meta.dir, 'git-harvest');

// ヘルパー: スクリプト実行（NO_COLOR=1 で ANSI エスケープを無効化）
function run(cwd: string, args = ''): string {
  return execSync(`bash ${SCRIPT} ${args}`, {
    cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

// ヘルパー: スクリプト実行（失敗を期待）
function runExpectFail(cwd: string, args = ''): { status: number; stderr: string } {
  try {
    execSync(`bash ${SCRIPT} ${args}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return { status: 0, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status: number; stderr: string };
    return { status: err.status, stderr: err.stderr };
  }
}

// ヘルパー: ブランチ一覧を取得
function branches(cwd: string): string[] {
  return execSync('git branch', { cwd, encoding: 'utf-8' })
    .split('\n')
    .map((b) => b.replace(/^[*+ ]+/, '').trim())
    .filter(Boolean);
}

// ヘルパー: git コマンド実行
function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: 'pipe' });
}

// ヘルパー: ファイルを作成してコミット
function commitFile(cwd: string, filename: string, message: string): void {
  writeFileSync(join(cwd, filename), `${filename}: ${message}\n`);
  git(cwd, `add ${filename}`);
  git(cwd, `commit -m "${message}"`);
}

// ヘルパー: worktree 一覧を取得
function worktrees(cwd: string): string[] {
  return execSync('git worktree list --porcelain', { cwd, encoding: 'utf-8' })
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.replace('worktree ', ''));
}

let bare: string;
let repo: string;

// テストごとに origin 付きリポジトリを作成
beforeEach(() => {
  bare = mkdtempSync(join(tmpdir(), 'git-harvest-bare-'));
  execSync(`git init --bare -b main ${bare}`);
  repo = mkdtempSync(join(tmpdir(), 'git-harvest-work-'));
  execSync(`git clone ${bare} ${repo}`);
  git(repo, 'config user.email "test@test.com"');
  git(repo, 'config user.name "Test"');
  commitFile(repo, 'README.md', 'init');
  git(repo, 'push');
});

afterEach(() => {
  // worktree は repo 外のディレクトリに作られるため、repo の rmSync では削除されない。先に除去する。
  try {
    const wts = worktrees(repo);
    for (const wt of wts) {
      if (wt !== repo) {
        try {
          git(repo, `worktree remove --force ${wt}`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  rmSync(bare, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('--help / --version', () => {
  // ヘルプ表示
  test('prints help and exits with 0', () => {
    const output = run(repo, '--help');
    expect(output).toContain('Usage: git-harvest');
    expect(output).toContain('--help');
    expect(output).toContain('--version');
  });

  // バージョン表示
  test('prints version and exits with 0', () => {
    const output = run(repo, '--version');
    expect(output).toMatch(/^git-harvest v\d+\.\d+\.\d+/);
  });
});

describe('default_branch', () => {
  // origin/HEAD 設定済み
  test('resolves default branch from origin/HEAD', () => {
    run(repo);
  });

  // origin/HEAD 未設定 → 自動復旧
  test('recovers via set-head --auto when origin/HEAD is unset', () => {
    git(repo, 'remote set-head origin -d');
    run(repo);
  });

  // remote なし → 異常終了
  test('exits with 1 when no remote is configured', () => {
    const noRemoteRepo = mkdtempSync(join(tmpdir(), 'git-harvest-noremote-'));
    try {
      execSync(`git init ${noRemoteRepo}`);
      git(noRemoteRepo, 'config user.email "test@test.com"');
      git(noRemoteRepo, 'config user.name "Test"');
      git(noRemoteRepo, 'commit --allow-empty -m "init"');

      const result = runExpectFail(noRemoteRepo);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Could not determine default branch');
    } finally {
      rmSync(noRemoteRepo, { recursive: true, force: true });
    }
  });
});

describe('merge detection', () => {
  // 通常マージ済み
  test('detects and deletes regular merged branches', () => {
    git(repo, 'checkout -b feature-regular');
    commitFile(repo, 'feature-regular.txt', 'feature work');
    git(repo, 'checkout main');
    git(repo, "merge feature-regular --no-ff -m 'merge feature'");
    git(repo, 'push');

    const output = run(repo);
    expect(branches(repo)).not.toContain('feature-regular');
    expect(branches(repo)).toContain('main');
    expect(output).toContain('[DELETED] feature-regular');
    expect(output).toContain('Harvested!');
  });

  // squash マージ済み
  test('detects and deletes squash-merged branches', () => {
    git(repo, 'checkout -b feature-squash');
    commitFile(repo, 'squash1.txt', 'squash work 1');
    commitFile(repo, 'squash2.txt', 'squash work 2');
    git(repo, 'checkout main');
    git(repo, 'merge --squash feature-squash');
    git(repo, 'commit -m "squash merge feature"');
    git(repo, 'push');

    const output = run(repo);
    expect(branches(repo)).not.toContain('feature-squash');
    expect(branches(repo)).toContain('main');
    expect(output).toContain('[DELETED] feature-squash');
    expect(output).toContain('Harvested!');
  });

  // 未マージは保持
  test('preserves unmerged branches', () => {
    git(repo, 'checkout -b feature-wip');
    commitFile(repo, 'wip.txt', 'wip');
    git(repo, 'checkout main');

    run(repo);
    expect(branches(repo)).toContain('feature-wip');
  });

  // マージ済みなし → Nothing to harvest メッセージ
  test('exits with 0 and shows nothing-to-harvest message when no merged branches exist', () => {
    const output = run(repo);
    expect(branches(repo)).toEqual(['main']);
    expect(output).toContain('Nothing to harvest. All clean!');
  });

  // 独自コミットなしのブランチは保持（作成直後の worktree 用ブランチ等）
  test('preserves branches with no unique commits', () => {
    git(repo, 'checkout -b no-commits-yet');
    git(repo, 'checkout main');

    run(repo);
    expect(branches(repo)).toContain('no-commits-yet');
  });

  // main より古いコミットを指す独自コミットなしブランチも保持
  test('preserves branches pointing to older commits with no unique work', () => {
    git(repo, 'checkout -b old-branch');
    git(repo, 'checkout main');
    // main を先に進める
    commitFile(repo, 'advance.txt', 'advance main');
    git(repo, 'push');

    run(repo);
    expect(branches(repo)).toContain('old-branch');
  });

  // 孤立ブランチはスキップ
  test('skips orphan branches without common ancestor', () => {
    git(repo, 'checkout --orphan isolated');
    commitFile(repo, 'orphan.txt', 'orphan commit');
    git(repo, 'checkout main');

    run(repo);
    expect(branches(repo)).toContain('isolated');
  });
});

describe('worktree cleanup', () => {
  // マージ済み worktree を削除
  test('removes worktrees for merged branches', () => {
    git(repo, 'checkout -b wt-merged');
    commitFile(repo, 'wt-merged.txt', 'wt work');
    git(repo, 'checkout main');
    git(repo, 'merge --squash wt-merged');
    git(repo, 'commit -m "squash merge wt"');
    git(repo, 'push');

    const wtDir = join(repo, '..', 'wt-merged-dir');
    git(repo, `worktree add ${wtDir} wt-merged`);
    expect(worktrees(repo).length).toBeGreaterThan(1);

    const output = run(repo);
    expect(branches(repo)).not.toContain('wt-merged');
    expect(worktrees(repo)).toHaveLength(1);
    expect(output).toContain('[DELETED]');
    expect(output).toContain('Harvested!');
  });

  // default branch の worktree は保持
  test('preserves worktree on default branch', () => {
    // main の worktree を追加するため、まず別ブランチに退避
    git(repo, 'checkout -b temp-branch');
    const wtDir = join(repo, '..', 'wt-main-dir');
    git(repo, `worktree add ${wtDir} main`);

    // temp-branch から実行（main は worktree にいる）
    const wtCountBefore = worktrees(repo).length;
    run(repo);
    expect(worktrees(repo).length).toBe(wtCountBefore);

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // 未マージ worktree は保持
  test('preserves worktrees for unmerged branches', () => {
    git(repo, 'checkout -b wt-unmerged');
    commitFile(repo, 'wt-unmerged.txt', 'unmerged work');
    git(repo, 'checkout main');

    const wtDir = join(repo, '..', 'wt-unmerged-dir');
    git(repo, `worktree add ${wtDir} wt-unmerged`);

    run(repo);
    expect(branches(repo)).toContain('wt-unmerged');
    expect(worktrees(repo).length).toBeGreaterThan(1);

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // 独自コミットなしの worktree は保持
  test('preserves worktrees for branches with no unique commits', () => {
    const wtDir = join(repo, '..', 'wt-no-commits-dir');
    git(repo, `worktree add -b wt-no-commits ${wtDir}`);

    run(repo);
    expect(branches(repo)).toContain('wt-no-commits');
    expect(worktrees(repo).length).toBeGreaterThan(1);

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // worktree なし → 正常通過
  test('succeeds when no worktrees exist', () => {
    git(repo, 'checkout -b feature-no-wt');
    commitFile(repo, 'no-wt.txt', 'work');
    git(repo, 'checkout main');
    git(repo, 'merge --squash feature-no-wt');
    git(repo, 'commit -m "squash"');
    git(repo, 'push');

    run(repo);
    expect(branches(repo)).not.toContain('feature-no-wt');
  });

  // 手動削除済み worktree を prune
  test('prunes manually deleted worktree entries', () => {
    git(repo, 'checkout -b wt-prune');
    commitFile(repo, 'wt-prune.txt', 'prune work');
    git(repo, 'checkout main');

    const wtDir = mkdtempSync(join(tmpdir(), 'git-harvest-wt-prune-'));
    git(repo, `worktree add ${wtDir} wt-prune`);

    // worktree ディレクトリを手動で削除（git worktree remove ではなく）
    rmSync(wtDir, { recursive: true, force: true });

    run(repo);
    // prune 後は stale エントリが消えている（wt-prune ブランチは未マージなので残る）
    expect(branches(repo)).toContain('wt-prune');
  });
});

describe('combined scenarios', () => {
  // worktree + ブランチ両方削除
  test('removes both worktree and branch for merged work', () => {
    git(repo, 'checkout -b combo-merged');
    commitFile(repo, 'combo.txt', 'combo work');
    git(repo, 'checkout main');
    git(repo, 'merge --squash combo-merged');
    git(repo, 'commit -m "squash combo"');
    git(repo, 'push');

    const wtDir = join(repo, '..', 'combo-wt-dir');
    git(repo, `worktree add ${wtDir} combo-merged`);

    const output = run(repo);
    expect(branches(repo)).not.toContain('combo-merged');
    expect(worktrees(repo)).toHaveLength(1);
    expect(output).toContain('[DELETED]');
    expect(output).toContain('Harvested!');
  });

  // マージ済みと未マージの混在
  test('deletes only merged branches when mixed with unmerged', () => {
    git(repo, 'checkout -b merged-one');
    commitFile(repo, 'merged.txt', 'merged work');
    git(repo, 'checkout main');
    git(repo, 'merge --squash merged-one');
    git(repo, 'commit -m "squash one"');
    git(repo, 'push');

    git(repo, 'checkout -b unmerged-one');
    commitFile(repo, 'unmerged.txt', 'unmerged work');
    git(repo, 'checkout main');

    run(repo);
    expect(branches(repo)).not.toContain('merged-one');
    expect(branches(repo)).toContain('unmerged-one');
  });

  // master がデフォルトブランチ
  test('works when default branch is master', () => {
    const masterBare = mkdtempSync(join(tmpdir(), 'git-harvest-master-bare-'));
    const masterRepo = mkdtempSync(join(tmpdir(), 'git-harvest-master-work-'));
    try {
      execSync(`git init --bare -b master ${masterBare}`);
      execSync(`git clone ${masterBare} ${masterRepo}`);
      git(masterRepo, 'config user.email "test@test.com"');
      git(masterRepo, 'config user.name "Test"');
      commitFile(masterRepo, 'README.md', 'init');
      git(masterRepo, 'push -u origin master');

      git(masterRepo, 'checkout -b feature-on-master');
      commitFile(masterRepo, 'feature.txt', 'feature');
      git(masterRepo, 'checkout master');
      git(masterRepo, 'merge --squash feature-on-master');
      git(masterRepo, 'commit -m "squash"');
      git(masterRepo, 'push');

      run(masterRepo);
      expect(branches(masterRepo)).not.toContain('feature-on-master');
      expect(branches(masterRepo)).toContain('master');
    } finally {
      rmSync(masterBare, { recursive: true, force: true });
      rmSync(masterRepo, { recursive: true, force: true });
    }
  });

  // dry-run ではブランチも worktree も削除されない
  test('dry-run does not delete anything', () => {
    git(repo, 'checkout -b dry-run-branch');
    commitFile(repo, 'dry.txt', 'dry work');
    git(repo, 'checkout main');
    git(repo, 'merge --squash dry-run-branch');
    git(repo, 'commit -m "squash dry"');
    git(repo, 'push');

    const wtDir = join(repo, '..', 'dry-run-wt-dir');
    git(repo, `worktree add ${wtDir} dry-run-branch`);

    const output = run(repo, '--dry-run');
    // ブランチも worktree も残っている
    expect(branches(repo)).toContain('dry-run-branch');
    expect(worktrees(repo).length).toBeGreaterThan(1);
    // 出力にはサマリーが表示される
    expect(output).toContain('Dry run mode');
    expect(output).toContain('[WILL DELETE]');
    expect(output).toContain('dry-run-wt-dir');
    // worktree にチェックアウト中のブランチは削除できないので表示されない
    expect(output).not.toContain('[WILL DELETE] dry-run-branch');
    expect(output).toContain('Harvested!');

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // ブランチ名がマージ済みブランチのプレフィックスでも誤マッチしない
  test('does not delete worktree whose branch name is a prefix of a merged branch', () => {
    // feature-login をマージ済みにする
    git(repo, 'checkout -b feature-login');
    commitFile(repo, 'login.txt', 'login');
    git(repo, 'checkout main');
    git(repo, 'merge --squash feature-login');
    git(repo, 'commit -m "squash feature-login"');
    git(repo, 'push');

    // feature は未マージのまま worktree を作成
    git(repo, 'checkout -b feature');
    commitFile(repo, 'feature.txt', 'feature work');
    git(repo, 'checkout main');

    const wtDir = join(repo, '..', 'wt-feature-dir');
    git(repo, `worktree add ${wtDir} feature`);

    run(repo);
    // feature-login は削除されるが、feature の worktree とブランチは残る
    expect(branches(repo)).not.toContain('feature-login');
    expect(branches(repo)).toContain('feature');
    expect(worktrees(repo).length).toBeGreaterThan(1);

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // dry-run でステージ済み変更のある worktree は表示しない
  test('dry-run skips worktrees with staged-only changes', () => {
    git(repo, 'checkout -b drywt-staged');
    commitFile(repo, 'staged-base.txt', 'base');
    git(repo, 'checkout main');
    git(repo, 'merge --squash drywt-staged');
    git(repo, 'commit -m "squash staged"');
    git(repo, 'push');

    const wtDir = join(repo, '..', 'drywt-staged-dir');
    git(repo, `worktree add ${wtDir} drywt-staged`);
    // worktree でファイルをステージだけして、コミットはしない
    writeFileSync(join(wtDir, 'staged-only.txt'), 'staged\n');
    git(wtDir, 'add staged-only.txt');

    const output = run(repo, '--dry-run');
    expect(output).not.toContain(`[WILL DELETE] ${wtDir}`);

    // cleanup
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // dry-run でメインワーキングツリーは表示しない
  test('dry-run skips main working tree', () => {
    git(repo, 'checkout -b drywt-main-check');
    commitFile(repo, 'drywt.txt', 'work');
    git(repo, 'checkout main');
    git(repo, 'merge --squash drywt-main-check');
    git(repo, 'commit -m "squash drywt"');
    git(repo, 'push');

    const output = run(repo, '--dry-run');
    // メインワーキングツリー (repo 自体) は Worktrees セクションに含まれない
    expect(output).not.toContain(`[WILL DELETE] ${repo}`);
  });

  // dry-run で未コミット変更のある worktree は表示しない
  test('dry-run skips dirty worktrees', () => {
    git(repo, 'checkout -b drywt-dirty');
    commitFile(repo, 'dirty-base.txt', 'base');
    git(repo, 'checkout main');
    git(repo, 'merge --squash drywt-dirty');
    git(repo, 'commit -m "squash dirty"');
    git(repo, 'push');

    const wtDir = join(repo, '..', 'drywt-dirty-dir');
    git(repo, `worktree add ${wtDir} drywt-dirty`);
    // worktree に未コミットの変更を追加
    writeFileSync(join(wtDir, 'uncommitted.txt'), 'dirty\n');

    const output = run(repo, '--dry-run');
    // dirty な worktree は Worktrees セクションに表示されない
    expect(output).not.toContain(`[WILL DELETE] ${wtDir}`);
    // worktree にチェックアウト中のブランチも削除できないので表示されない
    expect(output).not.toContain('[WILL DELETE] drywt-dirty');

    // cleanup
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // exit code 0
  test('exits with 0 on successful cleanup', () => {
    git(repo, 'checkout -b to-clean');
    commitFile(repo, 'clean.txt', 'clean me');
    git(repo, 'checkout main');
    git(repo, 'merge --squash to-clean');
    git(repo, 'commit -m "squash clean"');
    git(repo, 'push');

    // run() は execSync なので失敗したら throw される
    // 正常に返ることが exit 0 の証明
    run(repo);
  });
});
