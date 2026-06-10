import type { ActionResult } from "./types";

const BRAND = "192;255;57";

export function bold(s: string, color = useColor()): string {
  return color ? `[1m${s}[0m` : s;
}

export function dim(s: string, color = useColor()): string {
  return color ? `[2m${s}[0m` : s;
}

export function hi(s: string, color = useColor()): string {
  return color ? `[38;2;${BRAND}m${s}[0m` : s;
}

export function relpath(p: string): string {
  const home = process.env.HOME;

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

      return color ? `[2m${line}[0m` : line;
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
