import type { BranchActionResult, WorktreeActionResult } from "../types";
import { bold, dim, hi, isColorSupported } from "./color";
import { tildify } from "./tildify";

export function statusLine(
  result: BranchActionResult | WorktreeActionResult,
  isColorEnabled = isColorSupported(),
): string {
  // worktree は path、branch は branch 名。どちらの識別子かは型で分かれる
  const name = tildify("path" in result ? result.path : result.name);

  switch (result.action) {
    case "failed": {
      return `  ${hi("✗", isColorEnabled)}  ${name}  ${result.message}`;
    }
    case "kept": {
      const pad = Math.max(2, 38 - name.length);
      const line = `  ·  ${name}${" ".repeat(pad)}${result.message}`;

      return dim(line, isColorEnabled);
    }
    case "removed": {
      return `  ${hi("✓", isColorEnabled)}  ${name}`;
    }
    case "would-remove": {
      return `  ${hi("→", isColorEnabled)}  ${name}`;
    }
  }
}

export function summaryLine(
  n: number,
  isDryRun: boolean,
  isColorEnabled = isColorSupported(),
): string {
  if (n === 0) {
    return dim("· Nothing to harvest. All growing.", isColorEnabled);
  }

  if (isDryRun) {
    return `${hi("→", isColorEnabled)} ${bold(`Would harvest ${String(n)} item(s)`, isColorEnabled)}`;
  }

  return `${hi("✓", isColorEnabled)} ${bold(`Harvested ${String(n)} item(s)`, isColorEnabled)}`;
}
