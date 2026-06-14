// Stage = 消した時の危険度。files-changed（未コミットの変更あり）は消すと復元できず最も危険、
// committed（コミット済み・base 未取り込み）は履歴から復元可能、merged（base 取り込み済み）は安全
export type Stage = "committed" | "files-changed" | "merged";

// 危険 → 安全の順。フラグはこのはしごの閾値を下げ、閾値以上（安全側）を削除対象にする
export const SAFETY: readonly Stage[] = ["files-changed", "committed", "merged"];

export const WORKTREE_SCOPES = ["worktree", "claude-worktree"] as const;

// scope の一覧は 1 箇所だけにする（worktree 系 + branch から導出）
export const SCOPES = [...WORKTREE_SCOPES, "branch"] as const;

export type ActionResult =
  | { action: "failed"; error: string; name: string }
  | { action: "kept"; name: string; reason: string }
  | { action: "removed"; name: string }
  | { action: "would-remove"; name: string };

// untouched=独自コミット無し / merged=base 取り込み済み / other=未取り込み
export type Classification = "merged" | "other" | "untouched";

// worktree / branch の両 decide が返す共有の判定結果（どちらの所有でもないので types に置く）
export type CleanupDecisionResult = { reason: string; remove: false } | { remove: true };

export type CleanupResult = { failures: number; results: ActionResult[] };

export type Flags = {
  detached: boolean;
  dryRun: boolean;
  thresholds: Record<Scope, Stage>;
  untouched: boolean;
};

export type Scope = (typeof SCOPES)[number];

// worktree 掃除が branch 掃除へ引き継ぐ情報: 生存 worktree（main + kept + failed）が checkout 中の branch 名
export type WorktreeCleanupResult = CleanupResult & { survivingBranches: Set<string> };

// stage が threshold 以降（安全側）なら削除対象
export function atOrSafer(stage: Stage, threshold: Stage): boolean {
  return SAFETY.indexOf(stage) >= SAFETY.indexOf(threshold);
}
