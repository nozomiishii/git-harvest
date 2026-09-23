import type { BranchActionResult, WorktreeActionResult } from "../types";
import { bold, dim, hi, isColorSupported } from "./color";
import { tildify } from "./tildify";

/**
 * worktree またはブランチの処理結果を一行に整形する。
 *
 * @param result - 表示するブランチまたは worktree の処理結果。
 *
 * @param isColorEnabled - ANSI の装飾を付けるかどうか。
 *
 * @returns 処理結果を表す表示行。
 */
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

/**
 * 削除件数のまとめを一行に整形する。
 *
 * @param n - 削除した項目または削除予定の項目数。
 *
 * @param isDryRun - 削除せず予定だけ返す指定。
 *
 * @param isColorEnabled - ANSI の装飾を付けるかどうか。
 *
 * @returns 削除件数と dry-run 状態を示す表示行。
 */
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
