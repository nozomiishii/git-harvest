export type Stage = "committed" | "files-changed" | "merged";

export const SAFETY: readonly Stage[] = ["files-changed", "committed", "merged"];

export const SCOPES = ["worktree", "claude-worktree", "branch"] as const;

export type Scope = (typeof SCOPES)[number];

export const WORKTREE_SCOPES = ["worktree", "claude-worktree"] as const;

export type ActionResult =
  | { action: "failed"; error: string; name: string }
  | { action: "kept"; name: string; reason: string }
  | { action: "removed"; name: string }
  | { action: "would-remove"; name: string };

// untouched=独自コミット無し / merged=base 取り込み済み / other=未取り込み
export type Classification = "merged" | "other" | "untouched";

// worktree / branch の両 decide が返す共有の判定結果（どちらの所有でもないので types に置く）
export type CleanupDecisionResult = { reason: string; remove: false } | { remove: true };

export type CleanupResult = { failures: number; results: ActionResult[]; survivingPaths: string[] };

export type Flags = {
  detached: boolean;
  dryRun: boolean;
  thresholds: Record<Scope, Stage>;
  untouched: boolean;
};

// stage が threshold 以降（安全側）なら削除対象
export function atOrSafer(stage: Stage, threshold: Stage): boolean {
  return SAFETY.indexOf(stage) >= SAFETY.indexOf(threshold);
}
