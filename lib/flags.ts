import type { Flags, Scope, Stage } from "./types";
import { SAFETY, SCOPES, WORKTREE_SCOPES } from "./types";

// 掃除を実行しない脱出口。argv のどこにあってもフラグより優先される
export type Subcommand = "help" | "logo" | "version";

export class UsageError extends Error {}

const STAGE_SCOPES: Record<"committed" | "files-changed", readonly Scope[]> = {
  committed: SCOPES,
  "files-changed": WORKTREE_SCOPES,
};

// preset を増やすときはここに 1 entry 足す。applyToken は threshold を下げる・toggle を true に
// するだけ（単調）なので、preset と単体フラグはどの順で並んでも同じ結果になる
const PRESETS: Record<string, readonly string[]> = {
  "--yolo": ["--files-changed", "--committed", "--untouched", "--detached"],
};

export function defaultFlags(): Flags {
  return {
    detached: false,
    dryRun: false,
    thresholds: { branch: "merged", "claude-worktree": "merged", worktree: "merged" },
    untouched: false,
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

  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "-n") {
      flags.dryRun = true;
      continue;
    }
    const preset = PRESETS[arg];

    if (preset !== undefined) {
      for (const token of preset) {
        applyToken(flags, token);
      }
      continue;
    }

    if (applyToken(flags, arg)) {
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

function applyStage(
  flags: Flags,
  stage: "committed" | "files-changed",
  value: string | undefined,
): void {
  const allowed = STAGE_SCOPES[stage];
  const targets = value === undefined ? [...allowed] : value.split(",");

  for (const scope of targets) {
    if (!allowed.includes(scope as Scope)) {
      throw new UsageError(`invalid scope for --${stage}: ${scope}`);
    }
    flags.thresholds[scope as Scope] = lower(flags.thresholds[scope as Scope], stage);
  }
}

function applyToken(flags: Flags, arg: string): boolean {
  if (arg === "--untouched") {
    flags.untouched = true;

    return true;
  }

  if (arg === "--detached") {
    flags.detached = true;

    return true;
  }
  // split("=", 2) は3つ目以降を黙って捨てるため、先頭の = だけで分割して残り全体を value にする
  const eq = arg.indexOf("=");
  const token = eq === -1 ? arg : arg.slice(0, eq);
  const value = eq === -1 ? undefined : arg.slice(eq + 1);

  if (token === "--committed" || token === "--files-changed") {
    applyStage(flags, token === "--committed" ? "committed" : "files-changed", value);

    return true;
  }

  return false;
}

function lower(current: Stage, candidate: Stage): Stage {
  return SAFETY.indexOf(candidate) < SAFETY.indexOf(current) ? candidate : current;
}
