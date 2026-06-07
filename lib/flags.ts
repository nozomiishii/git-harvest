import type { Flags, Scope, Stage } from "./types";
import { SAFETY, SCOPES, WORKTREE_SCOPES } from "./types";

export type Parsed =
  | { flags: Flags; mode: "run" }
  | { mode: "help" }
  | { mode: "logo" }
  | { mode: "version" };

export class UsageError extends Error {}

const STAGE_SCOPES: Record<"committed" | "files-changed", readonly Scope[]> = {
  committed: SCOPES,
  "files-changed": WORKTREE_SCOPES,
};

const YOLO_TOKENS = ["--files-changed", "--committed", "--untouched", "--detached"];

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
  main/default worktree, current cwd worktree, locked worktree, worktree with a running agent session,
  current HEAD branch, branch checked out in a surviving worktree.
`;
}

export function parseArgs(argv: string[]): Parsed {
  for (const arg of argv) {
    if (arg === "logo") {
      return { mode: "logo" };
    }

    if (arg === "-h" || arg === "--help") {
      return { mode: "help" };
    }

    if (arg === "-v" || arg === "--version") {
      return { mode: "version" };
    }
  }
  const flags = defaultFlags();

  if (argv.includes("--yolo")) {
    for (const t of YOLO_TOKENS) {
      applyToken(flags, t);
    }
  }

  for (const arg of argv) {
    if (arg === "--yolo") {
      continue;
    }

    if (arg === "--dry-run" || arg === "-n") {
      flags.dryRun = true;
      continue;
    }

    if (applyToken(flags, arg)) {
      continue;
    }

    throw new UsageError(`unknown option: ${arg}`);
  }

  return { flags, mode: "run" };
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
  const [token, value] = arg.split("=", 2) as [string, string | undefined];

  if (token === "--committed" || token === "--files-changed") {
    applyStage(flags, token === "--committed" ? "committed" : "files-changed", value);

    return true;
  }

  return false;
}

function lower(current: Stage, candidate: Stage): Stage {
  return SAFETY.indexOf(candidate) < SAFETY.indexOf(current) ? candidate : current;
}
