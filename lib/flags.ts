import type { Flags } from "./types";
import { SCOPES, WORKTREE_SCOPES } from "./types";

// argv のどこにあってもフラグより優先される
export type Subcommand = "help" | "logo" | "version";

export class UsageError extends Error {}

// preset を増やすときはここに 1 entry 足す。各フラグは toggle を立てるだけ（単調）なので、
// preset と単体フラグはどの順で並んでも同じ結果になる
const PRESETS: Record<string, readonly string[]> = {
  "--yolo": ["--files-changed", "--committed", "--untouched", "--detached"],
};

export function defaultFlags(): Flags {
  return {
    branchCommitted: false,
    "claude-worktree": { committed: false, filesChanged: false },
    detached: false,
    dryRun: false,
    untouched: false,
    worktree: { committed: false, filesChanged: false },
  };
}

export function helpText(): string {
  return `git-harvest cleans up worktrees and branches based on commit lifecycle stage.

Stages (risky -> safe):
  files-changed  ->  committed  ->  merged

  A worktree/branch is classified by its most at-risk stage (uncommitted changes win).
  A flag lowers the threshold and deletes that stage and everything safer; merged is the safe default.
  "untouched" (no work, identical to base) and "detached" (no branch) sit off this ladder:
  kept by default, removed by --untouched / --detached (or --yolo).

Usage: git-harvest [options]
       git-harvest logo

Options:
  -h, --help                  Show this help
  -v, --version               Show version
  -n, --dry-run               Show what would be deleted without deleting

  --committed[=<scope>]       Delete from committed (committed + merged). scope: worktree,
                              claude-worktree, branch (default: all).
  --files-changed[=<scope>]   Delete from files-changed (uncommitted included). scope: worktree,
                              claude-worktree (default: all worktree scopes).
                              Multiple scopes: comma-separated or repeat the flag.
  --untouched                 Delete untouched worktrees (no work, identical to base; off-ladder).
  --detached                  Delete detached worktrees (no branch; off-ladder).
                              WARNING: a detached worktree's commits are unreachable -- removal can
                              lose them permanently (no reflog recovery).

  --yolo                      Preset: --files-changed --committed --untouched --detached (all scopes).
                              WARNING: removes uncommitted changes and detached commits (see --detached).

Subcommands:
  logo                        Show the git-harvest logo

Invariants are always protected (no flag or --yolo can override):
  main/default worktree, worktree on the base branch, current cwd worktree, locked worktree,
  worktree with a running agent session, current HEAD branch, branch checked out in a surviving worktree.
`;
}

export function parseFlags(argv: string[]): Flags {
  const flags = defaultFlags();

  // --yolo などの preset は先に個別フラグへ展開し、以降は arg を上から1つずつ解釈する
  const args = argv.flatMap((arg) => PRESETS[arg] ?? [arg]);

  for (const arg of args) {
    if (arg === "--dry-run" || arg === "-n") {
      flags.dryRun = true;
      continue;
    }

    if (arg === "--untouched") {
      flags.untouched = true;
      continue;
    }

    if (arg === "--detached") {
      flags.detached = true;
      continue;
    }

    // --committed[=scope] / --files-changed[=scope]。先頭の = だけで分割し、残り全体を scope 指定にする
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const scopes = eq === -1 ? undefined : arg.slice(eq + 1);

    if (name === "--committed") {
      applyCommittedFlag(flags, scopes);
      continue;
    }

    if (name === "--files-changed") {
      applyFilesChangedFlag(flags, scopes);
      continue;
    }

    throw new UsageError(`unknown option: ${arg}`);
  }

  return flags;
}

export function subcommandOf(argv: string[]): Subcommand | undefined {
  for (const arg of argv) {
    if (arg === "logo") {
      return "logo";
    }

    if (arg === "-h" || arg === "--help") {
      return "help";
    }

    if (arg === "-v" || arg === "--version") {
      return "version";
    }
  }

  return undefined;
}

// --committed: worktree 系 + branch。値無しは全 scope。toggle を立てるだけで下げ直さず order 非依存
function applyCommittedFlag(flags: Flags, value: string | undefined): void {
  const scopes = value === undefined ? [...SCOPES] : value.split(",");

  for (const scope of scopes) {
    if (scope === "branch") {
      flags.branchCommitted = true;
      continue;
    }

    if (scope === "worktree" || scope === "claude-worktree") {
      flags[scope].committed = true;
      continue;
    }

    throw new UsageError(`invalid scope for --committed: ${scope}`);
  }
}

// --files-changed: worktree 系 scope のみ。値無しは全 worktree 系。toggle を立てるだけで order 非依存
function applyFilesChangedFlag(flags: Flags, value: string | undefined): void {
  const scopes = value === undefined ? [...WORKTREE_SCOPES] : value.split(",");

  for (const scope of scopes) {
    if (scope !== "worktree" && scope !== "claude-worktree") {
      throw new UsageError(`invalid scope for --files-changed: ${scope}`);
    }

    flags[scope].filesChanged = true;
  }
}
