import type { Flags, Scope } from "../types";
import { SCOPES, WORKTREE_SCOPES } from "../types";

// argv のどこにあってもフラグより優先される
export type Subcommand = "help" | "logo" | "version";

export class UsageError extends Error {}

// 既知のフラグ名（= の前の部分）。これ以外は unknown として弾く
const FLAG_NAMES = new Set(["--committed", "--detached", "--dry-run", "--files-changed", "--untouched", "-n"]);

// preset を増やすときはここに 1 entry 足す。各フラグは対象 scope を足すだけ（単調）なので、
// preset と単体フラグはどの順で並んでも同じ結果になる
const PRESETS: Record<string, readonly string[]> = {
  "--yolo": ["--files-changed", "--committed", "--untouched", "--detached"],
};

export function defaultFlags(): Flags {
  return {
    committed: [],
    detached: false,
    dryRun: false,
    filesChanged: [],
    untouched: false,
  };
}

// argv を Flags へ変換する。各フィールドは args から 1 回ずつ求めるだけで、書き換えはしない
export function parseFlags(argv: string[]): Flags {
  // --yolo などの preset は先に個別フラグへ展開する
  const args = argv.flatMap((arg) => PRESETS[arg] ?? [arg]);
  rejectUnknown(args);

  return {
    committed: targetScopes(args, "--committed", SCOPES),
    detached: args.includes("--detached"),
    dryRun: args.includes("--dry-run") || args.includes("-n"),
    filesChanged: targetScopes(args, "--files-changed", WORKTREE_SCOPES),
    untouched: args.includes("--untouched"),
  };
}

export function parseSubcommand(argv: string[]): Subcommand | undefined {
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

// 既知フラグ以外が混ざっていれば弾く（= の前のフラグ名で判定）
function rejectUnknown(args: string[]): void {
  for (const arg of args) {
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);

    if (!FLAG_NAMES.has(name)) {
      throw new UsageError(`unknown option: ${arg}`);
    }
  }
}

// 指定フラグ（--committed / --files-changed）が対象にする scope を args から集める。
// 値無しは allowed 全部、値ありはカンマ区切り。allowed 外の scope は弾き、重複は除く
function targetScopes(args: string[], flag: string, allowed: readonly Scope[]): Scope[] {
  const scopes = new Set<Scope>();

  for (const arg of args) {
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);

    if (name !== flag) {
      continue;
    }
    const value = eq === -1 ? undefined : arg.slice(eq + 1);
    const targets = value === undefined ? allowed : value.split(",");

    for (const scope of targets) {
      if (!allowed.includes(scope as Scope)) {
        throw new UsageError(`invalid scope for ${flag}: ${scope}`);
      }
      scopes.add(scope as Scope);
    }
  }

  return [...scopes];
}
