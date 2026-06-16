// 画面に出す担当（旧 format + brand + logo を統合）
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { BranchActionResult, WorktreeActionResult } from "./types";

const ESC = String.fromCodePoint(27); // エスケープ文字(0x1b)。cat -v での ^[ の正体
const BRAND = "192;255;57";

// VHS 風ロゴ。logo.ascii を単一の真実として読む。
// dev (tsx) は lib/logo.ascii、build (tsdown) は dist/logo.ascii を指す（tsdown.config.ts でコピー）
export const logoArt = readFileSync(new URL("logo.ascii", import.meta.url), "utf8");

export function bold(s: string, color = useColor()): string {
  return color ? `${ESC}[1m${s}${ESC}[0m` : s;
}

export function dim(s: string, color = useColor()): string {
  return color ? `${ESC}[2m${s}${ESC}[0m` : s;
}

export function hi(s: string, color = useColor()): string {
  return color ? `${ESC}[38;2;${BRAND}m${s}${ESC}[0m` : s;
}

export function logo(color = useColor()): string {
  const body = logoArt
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => hi(line, color))
    .join("\n");

  return `\n${body}\n`;
}

export function relpath(p: string): string {
  const home = homedir();

  if (!home) {
    return p;
  }

  if (p === home) {
    return "~";
  }

  if (p.startsWith(`${home}/`)) {
    return `~${p.slice(home.length)}`;
  }

  return p;
}

export function statusLine(
  result: BranchActionResult | WorktreeActionResult,
  color = useColor(),
): string {
  // worktree は path、branch は branch 名。どちらの識別子かは型で分かれる
  const name = relpath("path" in result ? result.path : result.name);

  switch (result.action) {
    case "failed": {
      return `  ${hi("✗", color)}  ${name}  ${result.message}`;
    }
    case "kept": {
      const pad = Math.max(2, 38 - name.length);
      const line = `  ·  ${name}${" ".repeat(pad)}${result.message}`;

      return dim(line, color);
    }
    case "removed": {
      return `  ${hi("✓", color)}  ${name}`;
    }
    case "would-remove": {
      return `  ${hi("→", color)}  ${name}`;
    }
  }
}

export function summaryLine(n: number, dryRun: boolean, color = useColor()): string {
  if (n === 0) {
    return dim("· Nothing to harvest. All growing.", color);
  }

  if (dryRun) {
    return `${hi("→", color)} ${bold(`Would harvest ${String(n)} item(s)`, color)}`;
  }

  return `${hi("✓", color)} ${bold(`Harvested ${String(n)} item(s)`, color)}`;
}

export function useColor(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}
