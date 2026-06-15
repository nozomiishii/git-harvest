// 画面に出す担当（旧 format + brand + logo を統合）
import { homedir } from "node:os";
import type { ActionResult } from "./types";

const ESC = String.fromCharCode(27); // エスケープ文字(0x1b)。cat -v での ^[ の正体
const BRAND = "192;255;57";

// VHS 風ロゴ。String.raw でバックスラッシュをエスケープ無しのまま保持する
// （.ascii ファイル + 専用 loader だと tsx 実行（pnpm dev）で解決できないため、文字列定数で持つ）
export const logoArt = String.raw` \|/                     \|/
\\|//  ~~~~~~~~~~~~~~~  \\|//
 \|/        G I T        \|/
  |     H A R V E S T     |
 _|_______________________|_
`;

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

export function statusLine(result: ActionResult, color = useColor()): string {
  const name = relpath(result.name);

  switch (result.action) {
    case "failed": {
      return `  ${hi("✗", color)}  ${name}  ${result.error}`;
    }
    case "kept": {
      const pad = Math.max(2, 38 - name.length);
      const line = `  ·  ${name}${" ".repeat(pad)}${result.reason}`;

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
