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
