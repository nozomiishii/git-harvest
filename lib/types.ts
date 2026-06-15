// Stage = 消した時の危険度。files-changed（未コミットの変更あり）は消すと復元できず最も危険、
// committed（コミット済み・base 未取り込み）は履歴から復元可能、merged（base 取り込み済み）は安全
export type Stage = "committed" | "files-changed" | "merged";

export const WORKTREE_SCOPES = ["worktree", "claude-worktree"] as const;

// scope の一覧は 1 箇所だけにする（worktree 系 + branch から導出）
export const SCOPES = [...WORKTREE_SCOPES, "branch"] as const;

export type ActionResult =
  | { action: "failed"; error: string; name: string }
  | { action: "kept"; name: string; reason: string }
  | { action: "removed"; name: string }
  | { action: "would-remove"; name: string };

export type CleanupResult = { failures: number; results: ActionResult[] };

export type Flags = {
  branchCommitted: boolean; // branch は files-changed 段を持たない
  "claude-worktree": ScopeFlags;
  detached: boolean;
  dryRun: boolean;
  untouched: boolean;
  worktree: ScopeFlags;
};

export type Scope = (typeof SCOPES)[number];

// worktree 系 scope が持つ削除フラグ。committed を立てれば committed + merged を、
// filesChanged を立てれば files-changed も含めた全段を消す（立てた段以降＝安全側を削除）
export type ScopeFlags = { committed: boolean; filesChanged: boolean };

// worktree 掃除が branch 掃除へ引き継ぐ情報: 生存 worktree（main + kept + failed）が checkout 中の branch 名
export type WorktreeCleanupResult = CleanupResult & { survivingBranches: Set<string> };
