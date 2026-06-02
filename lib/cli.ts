import type { Flags } from './types';
import pkg from '../package.json';
import { cleanupBranches } from './branch';
import { logo } from './brand';
import { applyToken, PRESETS, renderFlagHelp } from './flags-spec';
import { formatSummary } from './format';
import { gitText } from './git';
import { defaultFlags } from './preset';
import { cleanupWorktrees } from './worktree';

// 実行モード。run 以外は副作用のない即時出力。
type Mode = 'help' | 'logo' | 'run' | 'version';

// argv パース結果。flags は run / dry-run 用、mode が分岐先。
type Parsed = {
  flags: Flags;
  mode: Mode;
};

// 未知フラグ用エラー。main の catch で usage を出して終了コード 1 にする。
class UsageError extends Error {}

// 削除の入口。base 解決 → worktree cleanup → その survivingPaths で branch cleanup。
// 結果は stdout、警告 / エラーは stderr。failures 合計 > 0 で終了コード 2、それ以外 0。
export async function main(argv: string[]): Promise<void> {
  let parsed: Parsed;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`git-harvest: ${message}\n\n`);
    process.stderr.write(helpText());
    process.exitCode = 1;

    return;
  }

  switch (parsed.mode) {
    case 'help': {
      process.stdout.write(helpText());

      return;
    }
    case 'logo': {
      process.stdout.write(`${logo()}\n`);

      return;
    }
    case 'run': {
      break;
    }
    case 'version': {
      process.stdout.write(`git-harvest v${readVersion()}\n`);

      return;
    }
  }

  const { flags } = parsed;

  // base を一度だけ解決し、以降の判定の土台にする。解決前に削除へ進まない。
  const base = await resolveBase();

  // resolveBase が解決失敗で終了コード 1 を設定済みなら、削除へ進まず終了する。
  if (base === undefined) return;

  // worktree を整理し、生き残った worktree path を branch 判定に渡す。
  const worktreeResult = await cleanupWorktrees(base, flags);

  const branchResult = await cleanupBranches(base, flags, worktreeResult.survivingPaths);

  // 結果サマリーを stdout へ。
  const summary = formatSummary(worktreeResult, branchResult);

  if (summary) process.stdout.write(`${summary}\n`);

  // 後処理: git worktree prune は cleanupWorktrees 側で実施済み。
  // git fetch --prune は post-merge hook で毎回走るとハング源になるため既定では実行しない。

  const failures = worktreeResult.failures + branchResult.failures;
  process.exitCode = failures > 0 ? 2 : 0;
}

// argv（process.argv.slice(2) 相当）を Flags + mode に落とす。
// --yolo は PRESETS.yolo（フラグ束）を default に上乗せ、個別フラグは applyToken が閾値を危険側へ下げる。
export function parseArgs(argv: string[]): Parsed {
  // logo / --help / --version は副作用なしの即時 mode。最優先で拾う。
  for (const arg of argv) {
    if (arg === 'logo') return { flags: defaultFlags(), mode: 'logo' };

    if (arg === '-h' || arg === '--help') return { flags: defaultFlags(), mode: 'help' };

    if (arg === '-v' || arg === '--version') return { flags: defaultFlags(), mode: 'version' };
  }

  // 常に保守的な default を土台にする。--yolo はその上に PRESETS.yolo を展開する。
  const flags = defaultFlags();

  if (argv.includes('--yolo')) {
    for (const token of PRESETS.yolo) applyToken(flags, token);
  }

  for (const arg of argv) {
    // --yolo は上で展開済み。--dry-run / -n は scope を持たない共通フラグ。
    if (arg === '--yolo') continue;

    if (arg === '--dry-run' || arg === '-n') {
      flags.dryRun = true;
      continue;
    }

    // 残りは scope フラグ。applyToken が一致すれば適用、未知なら usage エラー。
    if (applyToken(flags, arg)) continue;

    throw new UsageError(`unknown option: ${arg}`);
  }

  return { flags, mode: 'run' };
}

// origin/HEAD から base（default branch）を fail-closed で解決する。
// bash default_branch / samples の resolve_base 移植。main/master へ自動 fallback しない。
//   symbolic-ref で取得 → 空なら set-head --auto して再取得 → なお空なら stderr ヒント + 終了コード 1。
export async function resolveBase(): Promise<string | undefined> {
  let base = await fetchOriginHead();

  // 未設定ならリモートに問い合わせて自動設定し、もう一度取得する。
  if (!base) {
    await trySetOriginHead();
    base = await fetchOriginHead();
  }

  if (!base) {
    process.stderr.write(
      'git-harvest: cannot determine default branch (try: git remote set-head origin <branch>)\n',
    );
    process.exitCode = 1;

    return;
  }

  return base;
}

// origin/HEAD を symbolic-ref で取得し branch 名を返す。未設定 / 失敗時は空文字。
async function fetchOriginHead(): Promise<string> {
  try {
    return stripOriginPrefix(await gitText(['symbolic-ref', 'refs/remotes/origin/HEAD']));
  } catch {
    return '';
  }
}

// help 全文。冒頭に progression model（issue の help 必須要素）を置き、全フラグとサブコマンドを列挙する。
function helpText(): string {
  return `git-harvest cleans up worktrees and branches based on commit lifecycle stage.

Stages (risky -> safe):
  files-changed  ->  committed  ->  merged

  Each worktree/branch is classified by its most at-risk stage
  (uncommitted changes win over the branch's commit state).
  A flag deletes that stage and everything safer; merged is the safe default.

  "untouched" (no unique commits, identical to base) and "detached" (no branch)
  sit off this ladder: kept by default, removed only by their own flag or --yolo.

Usage: git-harvest [options]
       git-harvest logo

Options:
  -h, --help                        Show this help
  -v, --version                     Show version
  -n, --dry-run                     Show what would be deleted without deleting

${renderFlagHelp()}

  --yolo                            Delete everything except invariants (main/default, current cwd,
                                    locked, running session, checked-out). Uncommitted included.
                                    WARNING: removes uncommitted changes and detached commits
                                    without any confirmation prompt.

Subcommands:
  logo                              Show the git-harvest logo

Invariants are always protected (cannot be overridden by any flag or --yolo):
  main/default-branch worktree, current cwd worktree, locked worktree,
  worktree with a running Claude session, current HEAD branch,
  branch checked out in a surviving worktree.
`;
}

// package.json の version を読む。静的 import なのでビルド時にインライン化され、
// dist/git-harvest 単体でも正しく出る。release-please とずれない。
function readVersion(): string {
  return pkg.version;
}

// refs/remotes/origin/ プレフィックスを落として branch 名だけにする。
function stripOriginPrefix(ref: string): string {
  return ref.replace(/^refs\/remotes\/origin\//, '');
}

// origin/HEAD をリモートに問い合わせて自動設定する（短タイムアウトでハングを防ぐ）。
// 失敗は致命でないので無視する。呼び出し側が再取得し、なお空なら fail-closed する。
async function trySetOriginHead(): Promise<void> {
  try {
    await gitText(['-c', 'http.connectTimeout=3', 'remote', 'set-head', 'origin', '--auto']);
  } catch {
    // set-head 失敗は無視。
  }
}

// 実行エントリ。npm publish した dist/git-harvest を node が shebang で実行する。
await main(process.argv.slice(2));
