import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Flags } from "./types";
import pkg from "../package.json" with { type: "json" };
import { cleanupBranches } from "./branch";
import { logo } from "./brand";
import { helpText, parseFlags, subcommandOf, UsageError } from "./flags";
import { bold, dim, statusLine, summaryLine, useColor } from "./format";
import { gitText } from "./git";
import { cleanupWorktrees } from "./worktree";

type ResolveOpts = { cwd?: string; offline?: boolean };

export async function main(argv: string[]): Promise<void> {
  const sub = subcommandOf(argv);

  if (sub === "help") {
    process.stdout.write(helpText());

    return;
  }

  if (sub === "version") {
    process.stdout.write(`git-harvest v${pkg.version}\n`);

    return;
  }

  if (sub === "logo") {
    process.stdout.write(`${logo()}\n`);

    return;
  }
  let flags: Flags;

  try {
    flags = parseFlags(argv);
  } catch (error) {
    const message = error instanceof UsageError ? error.message : String(error);
    process.stderr.write(`git-harvest: ${message}\n\n${helpText()}`);
    process.exitCode = 1;

    return;
  }
  const base = await resolveBase();

  if (base === undefined) {
    return;
  }
  process.stdout.write(`\n${bold("git harvest", useColor())}\n`);

  if (flags.dryRun) {
    process.stdout.write(`\n${dim("Dry run mode - nothing will be deleted")}\n`);
  }
  const wt = await cleanupWorktrees(base, flags);
  const br = await cleanupBranches(base, flags, wt.survivingPaths);

  if (wt.results.length > 0) {
    process.stdout.write(
      `\n${bold("Worktrees")}\n${wt.results.map((r) => statusLine(r)).join("\n")}\n`,
    );
  }

  if (br.results.length > 0) {
    process.stdout.write(
      `\n${bold("Branches")}\n${br.results.map((r) => statusLine(r)).join("\n")}\n`,
    );
  }
  const n = [...wt.results, ...br.results].filter(
    (r) => r.action === "removed" || r.action === "would-remove",
  ).length;
  process.stdout.write(`\n${summaryLine(n, flags.dryRun)}\n\n`);
  process.exitCode = wt.failures + br.failures > 0 ? 2 : 0;
}

export async function resolveBase(opts: ResolveOpts = {}): Promise<string | undefined> {
  let base = await gitText(["symbolic-ref", "refs/remotes/origin/HEAD"], opts)
    .then(stripOrigin)
    .catch(() => "");

  if (!base && opts.offline !== true) {
    await gitText(
      ["-c", "http.connectTimeout=3", "remote", "set-head", "origin", "--auto"],
      opts,
    ).catch(() => "");
    base = await gitText(["symbolic-ref", "refs/remotes/origin/HEAD"], opts)
      .then(stripOrigin)
      .catch(() => "");
  }

  if (!base) {
    process.stderr.write(
      "git-harvest: cannot determine default branch (try: git remote set-head origin <branch>)\n",
    );
    process.exitCode = 1;

    return undefined;
  }

  return base;
}

// このファイルが node のエントリとして直接実行された時だけ true（import 時は false）
function isEntrypoint(): boolean {
  const entry = process.argv[1];

  if (entry === undefined) {
    return false;
  }

  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function stripOrigin(ref: string): string {
  return ref.replace(/^refs\/remotes\/origin\//, "");
}

if (isEntrypoint()) {
  await main(process.argv.slice(2));
}
