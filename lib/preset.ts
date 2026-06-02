import type { Flags } from "./types";

// default（bare git-harvest）: 保守的。全 scope の閾値 merged のみ削除し、
// detached / untouched は保護、dryRun は false。
// 明示リテラルのまま保つ: Flags にフィールドを足した時の初期化漏れを tsc が compile error で捕まえる。
// --yolo は defaultFlags() を土台に flags-spec.ts の PRESETS.yolo を上乗せして作る。
export function defaultFlags(): Flags {
  return {
    branch: "merged",
    claudeWorktree: "merged",
    claudeWorktreeDetached: false,
    claudeWorktreeUntouched: false,
    dryRun: false,
    worktree: "merged",
    worktreeDetached: false,
    worktreeUntouched: false,
  };
}
