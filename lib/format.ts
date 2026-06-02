import type { ActionResult, CleanupResult } from "./types";
import { BRAND_COLOR } from "./brand";

// 1 リソースの処理結果を 1 行文字列にする（末尾改行なし）。
//   removed      → ✓（ブランドカラー）
//   would-remove → →（ブランドカラー）
//   kept         → ·（dim）+ reason（dim）
//   failed       → error（red）
export function formatResult(r: ActionResult): string {
  switch (r.action) {
    case "failed": {
      return `  ${red(`✗  ${r.name}: ${r.error}`)}`;
    }
    case "kept": {
      return `  ${dim(`·  ${padReason(r.name, r.reason)}`)}`;
    }
    case "removed": {
      return `  ${brand("✓")}  ${r.name}`;
    }
    case "would-remove": {
      return `  ${brand("→")}  ${r.name}`;
    }
  }
}

// worktree と branch の CleanupResult をまとめて複数行文字列にする（末尾改行なし）。
// セクション見出し（Worktrees / Branches）はその scope に結果があるときだけ出す。
// 実際の stdout 書き込みは cli に任せ、ここは文字列を返すだけ。
export function formatSummary(worktree: CleanupResult, branch: CleanupResult): string {
  const sections: string[] = [];

  if (worktree.results.length > 0) {
    sections.push(["Worktrees", ...worktree.results.map((r) => formatResult(r))].join("\n"));
  }

  if (branch.results.length > 0) {
    sections.push(["Branches", ...branch.results.map((r) => formatResult(r))].join("\n"));
  }

  return sections.join("\n\n");
}

// 着色可否。TTY かつ NO_COLOR 未設定のときだけ着色、それ以外プレーン。
// 評価のたびに env を読むので、テストは process.env.NO_COLOR の設定で固定できる。
export function useColor(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

// ブランドカラー（✓ removed / → will-delete マーカー用）。
function brand(s: string): string {
  return useColor() ? `\u001B[38;2;${BRAND_COLOR}m${s}\u001B[0m` : s;
}

// dim gray（· 保護マーカーと reason 用）。
function dim(s: string): string {
  return useColor() ? `\u001B[2m${s}\u001B[0m` : s;
}

// name と reason の間隔。bash print_growing と同じく column 38 を狙い、最低 2 spaces。
function padReason(name: string, reason: string): string {
  const pad = Math.max(2, 38 - name.length);

  return `${name}${" ".repeat(pad)}${reason}`;
}

// 端末デフォルト red（error 用）。CLI 規約 red=error を維持する。
function red(s: string): string {
  return useColor() ? `\u001B[31m${s}\u001B[0m` : s;
}
