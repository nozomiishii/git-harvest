import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, onTestFinished, test, vi } from 'vitest';
import {
  assertDefined,
  commitFile,
  makeOriginRepo,
  makeTempDir,
  type OriginRepo,
  tgit,
} from './test-helpers';

// CLI 全体の統合テスト。lib/cli.ts を `node --import tsx` で直接起動し、実 git リポジトリに対する
// end-to-end の挙動（invariant / 閾値 / --yolo / fail-closed / dry-run 一致）を確認する。

// このファイル（lib/ 配下）のディレクトリ。cli.ts は同階層。
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.ts');

// tsx の絶対 file:// URL。node --import はファイルURLを受け付けるため、
// 子プロセスの cwd がどこであっても解決できる。
const require = createRequire(import.meta.url);
const TSX_LOADER = pathToFileURL(require.resolve('tsx')).href;

// committed（base に未取り込みの独自コミットを持つ）branch + worktree を作る。返り値は worktree path。
function addCommittedWorktree(repo: string, root: string, branch: string, dir: string): string {
  tgit(repo, `branch ${branch} main`);
  const wt = path.join(root, dir);
  tgit(repo, `worktree add ${wt} ${branch}`);
  commitFile(wt, `${branch}.txt`, `commit ${branch}`);

  return wt;
}

// merged branch を作り（main へ --no-ff merge して push）、その branch の worktree を生やす。
// 返り値はその worktree path。
function addMergedWorktree(repo: string, root: string, branch: string, dir: string): string {
  tgit(repo, `checkout -b ${branch}`);
  commitFile(repo, `${branch}.txt`, `work ${branch}`);
  tgit(repo, 'checkout main');
  tgit(repo, `merge --no-ff ${branch} -m merge-${branch}`);
  tgit(repo, 'push');
  const wt = path.join(root, dir);
  tgit(repo, `worktree add ${wt} ${branch}`);

  return wt;
}

// branch 一覧（マーカーを落とした短縮名）。
function branches(cwd: string): string[] {
  return tgit(cwd, 'branch --format="%(refname:short)"')
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
}

// origin/HEAD を設定して base を解決できるようにした origin 付きリポジトリを作る。
function makeRepo(): OriginRepo {
  const origin = makeOriginRepo();
  tgit(origin.path, 'remote set-head origin main');

  return origin;
}

// cli を起動する。NO_COLOR で ANSI を無効化し、FORCE_COLOR を外す。
// node --import tsx で TypeScript ソースを直接実行する（extensionless import と
// package.json import の両方を tsx が解決する）。
// spawnSync は exit code に関わらず stdout / stderr を別々に返すので、成功時の stderr 警告も拾える。
// sessionsDir で Claude session 検出の対象を空ディレクトリへ隔離する。
function run(
  cwd: string,
  args: string[],
  sessionsDir: string,
): { status: number; stderr: string; stdout: string } {
  // env は渡さず親 env を継承させる。上書き 3 つは親に stub し、onTestFinished で復元する
  // （spawn した子プロセスは spawn 時の親 env を継承するので、これで子へ届く）。
  vi.stubEnv('NO_COLOR', '1');
  vi.stubEnv('FORCE_COLOR', '0');
  vi.stubEnv('GIT_HARVEST_CLAUDE_SESSIONS_DIR', sessionsDir);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, CLI, ...args], { cwd, encoding: 'utf8' });

  return { status: r.status ?? 1, stderr: r.stderr, stdout: r.stdout };
}

// 走行中 session を模した <pid>.json を sessionsDir に書く。生きた pid を渡すこと。
function writeSession(sessionsDir: string, pid: number, cwd: string): void {
  writeFileSync(
    path.join(sessionsDir, `${String(pid)}.json`),
    JSON.stringify({ cwd, pid, status: 'busy' }),
  );
}

// --version は package.json の version を表示する
test('--version prints the package version', () => {
  using repo = makeRepo();
  using sess = makeTempDir();
  const { status, stdout } = run(repo.path, ['--version'], sess.path);

  expect(status).toBe(0);
  expect(stdout).toMatch(/^git-harvest v\d+\.\d+\.\d+/);
});

// --help は progression model と全 scope のフラグを表示する
test('--help shows the progression model and all flags', () => {
  using repo = makeRepo();
  using sess = makeTempDir();
  const { status, stdout } = run(repo.path, ['--help'], sess.path);

  expect(status).toBe(0);
  expect(stdout).toContain('files-changed  ->  committed  ->  merged');
  expect(stdout).toContain('--worktree-committed');
  expect(stdout).toContain('--claude-worktree-files-changed');
  expect(stdout).toContain('--branch-committed');
  expect(stdout).toContain('--worktree-detached');
  expect(stdout).toContain('--worktree-untouched');
  expect(stdout).toContain('--yolo');
  expect(stdout).toContain('logo');
});

// logo はワードマークを表示する
test('logo prints the wordmark', () => {
  using repo = makeRepo();
  using sess = makeTempDir();
  const { status, stdout } = run(repo.path, ['logo'], sess.path);

  expect(status).toBe(0);
  expect(stdout).toContain('H A R V E S T');
});

// 未知フラグはエラー終了し usage を表示する
test('unknown flag errors with usage', () => {
  using repo = makeRepo();
  using sess = makeTempDir();
  const { status, stderr } = run(repo.path, ['--bogus'], sess.path);

  expect(status).toBe(1);
  expect(stderr).toContain('unknown option: --bogus');
  expect(stderr).toContain('files-changed  ->  committed  ->  merged');
});

// default は merged worktree / branch だけ実削除し、committed / dirty は残す
test('default cleanup removes only merged worktree and branch, keeps committed and dirty', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const mergedWt = addMergedWorktree(repo.path, root.path, 'feat-merged', 'wt-merged');
  const committedWt = addCommittedWorktree(repo.path, root.path, 'feat-committed', 'wt-committed');
  // files-changed（dirty）worktree。
  tgit(repo.path, 'branch feat-dirty main');
  const dirtyWt = path.join(root.path, 'wt-dirty');
  tgit(repo.path, `worktree add ${dirtyWt} feat-dirty`);
  writeFileSync(path.join(dirtyWt, 'dirty.txt'), 'dirty\n');

  const { status } = run(repo.path, [], sess.path);

  expect(status).toBe(0);
  // merged は消える。
  expect(existsSync(mergedWt)).toBe(false);
  expect(branches(repo.path)).not.toContain('feat-merged');
  // committed / dirty は残る。
  expect(existsSync(committedWt)).toBe(true);
  expect(existsSync(dirtyWt)).toBe(true);
  expect(branches(repo.path)).toContain('feat-committed');
});

// untouched branch は default で削除される（merged 相当に畳まれる）
test('default cleanup removes an untouched branch', () => {
  using repo = makeRepo();
  using sess = makeTempDir();
  // 独自コミットなし・どの worktree にも checkout されていない branch。
  tgit(repo.path, 'branch leftover-label main');
  const { status } = run(repo.path, [], sess.path);

  expect(status).toBe(0);
  expect(branches(repo.path)).not.toContain('leftover-label');
});

// squash でマージした branch も merge済 として default で削除される
test('default cleanup removes a squash-merged branch', () => {
  using repo = makeRepo();
  using sess = makeTempDir();
  tgit(repo.path, 'checkout -b feat-squash');
  commitFile(repo.path, 'sq1.txt', 'sq one');
  commitFile(repo.path, 'sq2.txt', 'sq two');
  tgit(repo.path, 'checkout main');
  // squash 相当: 全変更を1コミットに畳んで main へ。
  tgit(repo.path, 'merge --squash feat-squash');
  tgit(repo.path, 'commit -m squash-feat-squash');
  tgit(repo.path, 'push');

  const { status } = run(repo.path, [], sess.path);

  expect(status).toBe(0);
  expect(branches(repo.path)).not.toContain('feat-squash');
});

// --claude-worktree-committed は claude path だけを下げ、通常 path worktree は触らない
test('--claude-worktree-committed leaves normal-path worktrees untouched', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  // 通常 path の committed worktree。
  const normalWt = addCommittedWorktree(repo.path, root.path, 'feat-normal', 'wt-normal');
  // claude path の committed worktree。
  tgit(repo.path, 'branch feat-claude main');
  mkdirSync(path.join(repo.path, '.claude', 'worktrees'), { recursive: true });
  const claudeWt = path.join(repo.path, '.claude', 'worktrees', 'feat-claude');
  tgit(repo.path, `worktree add ${claudeWt} feat-claude`);
  commitFile(claudeWt, 'cc.txt', 'claude commit');

  const { status } = run(repo.path, ['--claude-worktree-committed'], sess.path);

  expect(status).toBe(0);
  // claude path の committed は消える。
  expect(existsSync(claudeWt)).toBe(false);
  // 通常 path の committed は閾値が下がっていないので残る。
  expect(existsSync(normalWt)).toBe(true);
  expect(branches(repo.path)).toContain('feat-normal');
});

// --claude-worktree-committed は通常 path worktree が merged でも committed 閾値を適用しない
test('--claude-worktree-committed keeps a normal-path committed worktree', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const normalCommitted = addCommittedWorktree(repo.path, root.path, 'feat-only', 'wt-only');
  const { status, stdout } = run(repo.path, ['--claude-worktree-committed', '--dry-run'], sess.path);

  expect(status).toBe(0);
  expect(existsSync(normalCommitted)).toBe(true);
  // 通常 path は committed として保護表示される。
  expect(stdout).toMatch(/· {2}.*wt-only.*committed/);
});

// merge済 worktree を編集すると files-changed に戻り、default / committed 閾値では消えない
test('default and --worktree-committed keep an edited merged worktree', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const mergedWt = addMergedWorktree(repo.path, root.path, 'feat-edited', 'wt-edited');
  // merge済 worktree に未コミットの変更を入れる → files-changed が最優先になる。
  writeFileSync(path.join(mergedWt, 'edit.txt'), 'late edit\n');

  // default では残る。
  expect(run(repo.path, [], sess.path).status).toBe(0);
  expect(existsSync(mergedWt)).toBe(true);

  // committed 閾値でも残る（files-changed より安全側だけ消すため）。
  expect(run(repo.path, ['--worktree-committed'], sess.path).status).toBe(0);
  expect(existsSync(mergedWt)).toBe(true);
});

// 編集した merge済 worktree は --worktree-files-changed で消える
test('--worktree-files-changed removes an edited merged worktree', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const mergedWt = addMergedWorktree(repo.path, root.path, 'feat-edited2', 'wt-edited2');
  writeFileSync(path.join(mergedWt, 'edit.txt'), 'late edit\n');
  const { status } = run(repo.path, ['--worktree-files-changed'], sess.path);

  expect(status).toBe(0);
  expect(existsSync(mergedWt)).toBe(false);
});

// --yolo は通常 path / claude path とも未コミット込みで消し、invariant だけ残す
test('--yolo removes everything (incl. uncommitted) except invariants', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  addMergedWorktree(repo.path, root.path, 'feat-y-merged', 'wt-y-merged');
  addCommittedWorktree(repo.path, root.path, 'feat-y-committed', 'wt-y-committed');
  // 通常 path の dirty worktree。
  tgit(repo.path, 'branch feat-y-dirty main');
  const dirtyWt = path.join(root.path, 'wt-y-dirty');
  tgit(repo.path, `worktree add ${dirtyWt} feat-y-dirty`);
  writeFileSync(path.join(dirtyWt, 'dirty.txt'), 'dirty\n');
  // claude path の dirty worktree。
  tgit(repo.path, 'branch feat-y-claude main');
  mkdirSync(path.join(repo.path, '.claude', 'worktrees'), { recursive: true });
  const claudeWt = path.join(repo.path, '.claude', 'worktrees', 'feat-y-claude');
  tgit(repo.path, `worktree add ${claudeWt} feat-y-claude`);
  writeFileSync(path.join(claudeWt, 'cdirty.txt'), 'claude dirty\n');

  const { status } = run(repo.path, ['--yolo'], sess.path);

  expect(status).toBe(0);
  // 通常 path / claude path とも、dirty 込みで全部消える。
  expect(existsSync(path.join(root.path, 'wt-y-merged'))).toBe(false);
  expect(existsSync(path.join(root.path, 'wt-y-committed'))).toBe(false);
  expect(existsSync(dirtyWt)).toBe(false);
  expect(existsSync(claudeWt)).toBe(false);
  // invariant: カレント worktree と base branch だけ残る。
  expect(existsSync(repo.path)).toBe(true);
  expect(branches(repo.path)).toStrictEqual(['main']);
});

// locked worktree は --yolo でも残る
test('--yolo keeps a locked worktree', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const wt = addCommittedWorktree(repo.path, root.path, 'feat-locked', 'wt-locked');
  tgit(repo.path, `worktree lock ${wt}`);
  const { status } = run(repo.path, ['--yolo'], sess.path);

  expect(status).toBe(0);
  expect(existsSync(wt)).toBe(true);
  expect(branches(repo.path)).toContain('feat-locked');
});

// 走行中 Claude session のある worktree は --yolo でも残る
test('--yolo keeps a worktree with a running session', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const wt = addCommittedWorktree(repo.path, root.path, 'feat-session', 'wt-session');
  // 生きた pid を持つプロセスを spawn し、その pid で session JSON を書く。
  const sleepProc = spawn('sleep', ['60'], { detached: false });

  try {
    writeSession(sess.path, assertDefined(sleepProc.pid), wt);
    const { status } = run(repo.path, ['--yolo'], sess.path);

    expect(status).toBe(0);
    expect(existsSync(wt)).toBe(true);
    expect(branches(repo.path)).toContain('feat-session');
  } finally {
    sleepProc.kill('SIGKILL');
  }
});

// カレント worktree（cwd）と現在 HEAD branch は --yolo でも残る
test('--yolo keeps the current worktree and current HEAD branch', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  // committed worktree を作り、そこを cwd にして起動する。
  const wt = addCommittedWorktree(repo.path, root.path, 'feat-current', 'wt-current');
  const { status } = run(wt, ['--yolo'], sess.path);

  expect(status).toBe(0);
  // カレント worktree は消えない（消すと自爆する）。
  expect(existsSync(wt)).toBe(true);
  // その worktree の HEAD branch も残る。
  expect(branches(repo.path)).toContain('feat-current');
});

// origin remote が無いと base を解決できずエラー終了し、何も削除しない
test('base resolution errors and deletes nothing without an origin remote', () => {
  using solo = makeTempDir();
  using sess = makeTempDir();
  tgit(solo.path, 'init -b main');
  commitFile(solo.path, 'f.txt', 'init');
  // 掃除されうる branch を仕込む（fail-closed なら残るはず）。
  tgit(solo.path, 'branch stale main');

  const { status, stderr } = run(solo.path, [], sess.path);

  expect(status).toBe(1);
  expect(stderr).toContain('cannot determine default branch');
  // fail-closed: branch も worktree も残る。
  expect(branches(solo.path)).toContain('stale');
});

// detached worktree は default で保護され、--worktree-detached で消える
test('detached worktree: kept by default, removed by --worktree-detached', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  const head = tgit(repo.path, 'rev-parse HEAD').trim();
  const wt = path.join(root.path, 'wt-detached');
  tgit(repo.path, `worktree add --detach ${wt} ${head}`);

  // default では残る。
  expect(run(repo.path, [], sess.path).status).toBe(0);
  expect(existsSync(wt)).toBe(true);

  // 専用フラグで消える。
  expect(run(repo.path, ['--worktree-detached'], sess.path).status).toBe(0);
  expect(existsSync(wt)).toBe(false);
});

// untouched worktree は default で保護され、--worktree-untouched で消える
test('untouched worktree: kept by default, removed by --worktree-untouched', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  // 独自コミットなし・clean な worktree。
  tgit(repo.path, 'branch feat-untouched main');
  const wt = path.join(root.path, 'wt-untouched');
  tgit(repo.path, `worktree add ${wt} feat-untouched`);

  // default では残る。
  expect(run(repo.path, [], sess.path).status).toBe(0);
  expect(existsSync(wt)).toBe(true);

  // 専用フラグで消える。worktree が消えると untouched branch も解放され merged 相当で消える。
  const { status } = run(repo.path, ['--worktree-untouched'], sess.path);

  expect(status).toBe(0);
  expect(existsSync(wt)).toBe(false);
  expect(branches(repo.path)).not.toContain('feat-untouched');
});

// dry-run の予測（will-remove 集合）が本番の実削除結果と一致する
test('dry-run prediction equals the actual deletions', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  // merged worktree + branch、committed worktree、untouched branch を混在させる。
  const mergedWt = addMergedWorktree(repo.path, root.path, 'feat-dr-merged', 'wt-dr-merged');
  const committedWt = addCommittedWorktree(repo.path, root.path, 'feat-dr-committed', 'wt-dr-committed');
  tgit(repo.path, 'branch feat-dr-leftover main');

  // dry-run: 何も消えず、merged worktree / branch だけ will-remove。
  const dry = run(repo.path, ['--dry-run'], sess.path);

  expect(dry.status).toBe(0);
  expect(dry.stdout).toMatch(/→ {2}.*wt-dr-merged/);
  expect(dry.stdout).toContain('→  feat-dr-merged');
  expect(dry.stdout).toContain('→  feat-dr-leftover');
  // committed は保護される。
  expect(dry.stdout).toMatch(/· {2}.*wt-dr-committed/);
  // dry-run なので実体は全部残る。
  expect(existsSync(mergedWt)).toBe(true);
  expect(existsSync(committedWt)).toBe(true);
  expect(branches(repo.path)).toContain('feat-dr-merged');
  expect(branches(repo.path)).toContain('feat-dr-leftover');

  // 本番: dry-run が予測したものだけが実際に消える。
  const real = run(repo.path, [], sess.path);

  expect(real.status).toBe(0);
  expect(existsSync(mergedWt)).toBe(false);
  expect(branches(repo.path)).not.toContain('feat-dr-merged');
  expect(branches(repo.path)).not.toContain('feat-dr-leftover');
  // 予測どおり committed は残る。
  expect(existsSync(committedWt)).toBe(true);
  expect(branches(repo.path)).toContain('feat-dr-committed');
});

// merge済 worktree 上の branch は、worktree 解放を見越して dry-run でも will-remove になる
test('dry-run predicts removal of a branch checked out only in a worktree being removed', () => {
  using root = makeTempDir();
  using repo = makeRepo();
  using sess = makeTempDir();
  addMergedWorktree(repo.path, root.path, 'feat-dr-checkout', 'wt-dr-checkout');
  const dry = run(repo.path, ['--dry-run'], sess.path);

  expect(dry.status).toBe(0);
  // worktree が消える予定なので「currently checked out」では残さず will-remove と出す。
  expect(dry.stdout).toContain('→  feat-dr-checkout');
  expect(dry.stdout).not.toMatch(/feat-dr-checkout.*currently checked out/);
});
