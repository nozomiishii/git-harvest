import type { BranchActionResult, WorktreeActionResult } from "../types";
import { bold, dim, hi, useColor } from "./color";
import { tildify } from "./tildify";

export function statusLine(
  result: BranchActionResult | WorktreeActionResult,
  color = useColor(),
): string {
  // worktree は path、branch は branch 名。どちらの識別子かは型で分かれる
  const name = tildify("path" in result ? result.path : result.name);

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
