import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Flags } from "./types";
import pkg from "../package.json" with { type: "json" };
import { cleanupBranches } from "./branch";
import { logo } from "./brand";
import { helpText, parseFlags, subcommandOf, UsageError } from "./flags";
import { bold, dim, statusLine, summaryLine } from "./format";
import { resolveBase } from "./resolve-base";
import { cleanupWorktrees } from "./worktree";

// 実行の流れ: subcommand 判定 → フラグ解釈 → base branch 解決 → worktree 掃除 → branch 掃除 → 集計表示
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
  const flags = readFlags(argv);

  if (flags === undefined) {
    return;
  }
  const base = await resolveBase();

  if (base === undefined) {
    return;
  }
  process.stdout.write(`\n${bold("git harvest")}\n`);

  if (flags.dryRun) {
    process.stdout.write(`\n${dim("Dry run mode - nothing will be deleted")}\n`);
  }
  // worktree を先に掃除し、生き残った worktree が checkout 中の branch 名を branch 掃除へ引き継ぐ
  // （使用中の branch を誤って消さないため）
  const wt = await cleanupWorktrees(base, flags);
  const br = await cleanupBranches(base, flags, wt.survivingBranches);

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

// UsageError は usage 表示 + exit code 1 に変換する（成功時は Flags、失敗時は undefined）
function readFlags(argv: string[]): Flags | undefined {
  try {
    return parseFlags(argv);
  } catch (error) {
    const message = error instanceof UsageError ? error.message : String(error);
    process.stderr.write(`git-harvest: ${message}\n\n${helpText()}`);
    process.exitCode = 1;

    return undefined;
  }
}

if (isEntrypoint()) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    // 予期しない throw（一覧取得の git 失敗 等）は生スタックでなく整形メッセージ + 実行時失敗の exit 2 にする
    process.stderr.write(`git-harvest: ${String(error)}\n`);
    process.exitCode = 2;
  }
}
