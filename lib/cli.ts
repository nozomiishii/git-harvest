import type { Flags, Stage } from './types';
import pkg from '../package.json';
import { cleanupBranches } from './branch';
import { logo } from './brand';
import { formatSummary } from './format';
import { gitText } from './git';
import { defaultFlags, yoloFlags } from './preset';
import { SAFETY } from './types';
import { cleanupWorktrees } from './worktree';

// 実行モード。run 以外は副作用のない即時出力。
type Mode = 'help' | 'logo' | 'run' | 'version';

// argv パース結果。flags は run / dry-run 用、mode が分岐先。
type Parsed = {
  flags: Flags;
  mode: Mode;
  yolo: boolean; // --yolo 指定（非対話 + --yes 必須判定に使う）
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

  const { flags, yolo } = parsed;

  // --yolo は破壊的。非対話（非 TTY）で --yes が無ければ暴発防止に拒否する。
  if (yolo && !process.stdout.isTTY && !flags.yes) {
    process.stderr.write(
      'git-harvest: --yolo in a non-interactive context requires --yes (refusing to run)\n',
    );
    process.exitCode = 1;

    return;
  }

  // base を一度だけ解決し、以降の判定の土台にする。解決前に削除へ進まない。
  const base = await resolveBase();

  // resolveBase が解決失敗で終了コード 1 を設定済みなら、削除へ進まず終了する。
  if (base === undefined) return;

  // worktree を整理し、生き残った worktree path を branch 判定に渡す。
  const worktreeResult = await cleanupWorktrees(base, flags);

  // --yolo で未コミット変更を持つ worktree が削除対象に含まれれば件数を警告する。
  if (yolo) {
    const dirtyCount = worktreeResult.results.filter(
      (r) => r.action === 'removed' || r.action === 'would-remove',
    ).length;

    if (dirtyCount > 0) {
      process.stderr.write(
        `git-harvest: --yolo targets ${String(dirtyCount)} worktree(s); uncommitted changes may be lost\n`,
      );
    }
  }

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
// --yolo は yoloFlags() を土台に他フラグを反映、個別フラグは閾値を危険側へ下げる。
export function parseArgs(argv: string[]): Parsed {
  // logo / --help / --version は副作用なしの即時 mode。最優先で拾う。
  for (const arg of argv) {
    if (arg === 'logo') return { flags: defaultFlags(), mode: 'logo', yolo: false };

    if (arg === '-h' || arg === '--help') return { flags: defaultFlags(), mode: 'help', yolo: false };

    if (arg === '-v' || arg === '--version') return { flags: defaultFlags(), mode: 'version', yolo: false };
  }

  // --yolo があるかを先に判定し、土台 preset を決める。
  const yolo = argv.includes('--yolo');
  const flags = yolo ? yoloFlags() : defaultFlags();

  for (const arg of argv) {
    switch (arg) {
      case '--branch-committed': {
        flags.branch = lowerThreshold(flags.branch, 'committed');
        break;
      }
      case '--claude-worktree-committed': {
        flags.claudeWorktree = lowerThreshold(flags.claudeWorktree, 'committed');
        break;
      }
      case '--claude-worktree-detached': {
        flags.claudeWorktreeDetached = true;
        break;
      }
      case '--claude-worktree-files-changed': {
        flags.claudeWorktree = lowerThreshold(flags.claudeWorktree, 'files-changed');
        break;
      }
      case '--claude-worktree-untouched': {
        flags.claudeWorktreeUntouched = true;
        break;
      }
      case '--dry-run':
      case '-n': {
        flags.dryRun = true;
        break;
      }
      case '--worktree-committed': {
        flags.worktree = lowerThreshold(flags.worktree, 'committed');
        break;
      }
      case '--worktree-detached': {
        flags.worktreeDetached = true;
        break;
      }
      case '--worktree-files-changed': {
        flags.worktree = lowerThreshold(flags.worktree, 'files-changed');
        break;
      }
      case '--worktree-untouched': {
        flags.worktreeUntouched = true;
        break;
      }
      case '--yes':
      case '-y': {
        flags.yes = true;
        break;
      }
      case '--yolo': {
        break;
      } // 土台は決定済み。
      default: {
        throw new UsageError(`unknown option: ${arg}`);
      }
    }
  }

  return { flags, mode: 'run', yolo };
}

// origin/HEAD から base（default branch）を fail-closed で解決する。
// bash default_branch / samples の resolve_base 移植。main/master へ自動 fallback しない。
//   symbolic-ref で取得 → 空なら set-head --auto して再取得 → なお空なら stderr ヒント + 終了コード 1。
export async function resolveBase(): Promise<string | undefined> {
  let base: string;

  try {
    base = stripOriginPrefix(await gitText(['symbolic-ref', 'refs/remotes/origin/HEAD']));
  } catch {
    base = '';
  }

  // 未設定ならリモートに問い合わせて自動設定（短タイムアウトでハングを防ぐ）。失敗は無視。
  if (!base) {
    try {
      await gitText(['-c', 'http.connectTimeout=3', 'remote', 'set-head', 'origin', '--auto']);
    } catch {
      // set-head 失敗は致命でない。再取得で空なら下で fail-closed する。
    }

    try {
      base = stripOriginPrefix(await gitText(['symbolic-ref', 'refs/remotes/origin/HEAD']));
    } catch {
      base = '';
    }
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
  -y, --yes                         Confirm non-interactively (required by --yolo in hooks/non-TTY)

  Worktree threshold (normal path), deletes the stage and everything safer:
  --worktree-files-changed          Delete from files-changed (everything, uncommitted included)
  --worktree-committed              Delete from committed (committed and merged)

  Worktree threshold (.claude/worktrees/ path):
  --claude-worktree-files-changed   Delete from files-changed (everything)
  --claude-worktree-committed       Delete from committed

  Branch threshold (branches have no files-changed):
  --branch-committed                Delete from committed (everything)

  Off-ladder worktrees (kept by default):
  --worktree-detached               Delete detached normal-path worktrees
                                    WARNING: a detached worktree's commits are unreachable;
                                    removal can lose them permanently (no reflog recovery).
  --claude-worktree-detached        Delete detached .claude/worktrees/ worktrees (same warning)
  --worktree-untouched              Delete untouched normal-path worktrees
  --claude-worktree-untouched       Delete untouched .claude/worktrees/ worktrees

  --yolo                            Delete everything except invariants (main/default, current cwd,
                                    locked, running session, checked-out). Uncommitted included.
                                    WARNING: removes uncommitted changes and detached commits
                                    without confirmation. Requires --yes in hooks/non-TTY.

Subcommands:
  logo                              Show the git-harvest logo

Invariants are always protected (cannot be overridden by any flag or --yolo):
  main/default-branch worktree, current cwd worktree, locked worktree,
  worktree with a running Claude session, current HEAD branch,
  branch checked out in a surviving worktree.
`;
}

// 閾値を「より危険側（SAFETY index が小さい側）」へ下げる。複数指定 / --yolo 併用でも危険側が勝つ。
function lowerThreshold(current: Stage, candidate: Stage): Stage {
  return SAFETY.indexOf(candidate) < SAFETY.indexOf(current) ? candidate : current;
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

// 実行エントリ。npm publish した dist/git-harvest を node が shebang で実行する。
await main(process.argv.slice(2));
