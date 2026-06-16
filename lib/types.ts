// Stage = 消した時の危険度。files-changed（未コミットの変更あり）は消すと復元できず最も危険、
// committed（コミット済み・base 未取り込み）は履歴から復元可能、merged（base 取り込み済み）は安全
export type Stage = "committed" | "files-changed" | "merged";

export const WORKTREE_SCOPES = ["worktree", "claude-worktree"] as const;

// scope の一覧は 1 箇所だけにする（worktree 系 + branch から導出）
export const SCOPES = [...WORKTREE_SCOPES, "branch"] as const;

// branch 掃除の結果。name=branch 名。message は failed のエラー文 / kept の保存理由
export type BranchActionResult =
  | { action: "failed"; message: string; name: string }
  | { action: "kept"; message: string; name: string }
  | { action: "removed"; name: string }
  | { action: "would-remove"; name: string };

export type BranchCleanupResult = { failures: number; results: BranchActionResult[] };

export type Flags = {
  committed: Scope[]; // committed を消す対象 scope（worktree / claude-worktree / branch）
  detached: boolean;
  dryRun: boolean;
  filesChanged: Scope[]; // files-changed を消す対象 scope（worktree 系のみ）
  untouched: boolean;
};

export type Scope = (typeof SCOPES)[number];

// worktree 掃除の結果。path=worktree パス、branch=checkout 中の branch（detached なら undefined）。
// message は failed のエラー文 / kept の保存理由（どちらの意味かは action で決まる）
export type WorktreeActionResult =
  | { action: "failed"; branch: string | undefined; message: string; path: string }
  | { action: "kept"; branch: string | undefined; message: string; path: string }
  | { action: "removed"; branch: string | undefined; path: string }
  | { action: "would-remove"; branch: string | undefined; path: string };

// worktree 掃除 → branch 掃除へ引き継ぐ。mainBranch=常に生存する main worktree の checkout branch、
// results の kept/failed が生き残った linked worktree。branch 側がここから保護リストを組む
export type WorktreeCleanupResult = {
  failures: number;
  mainBranch: string | undefined;
  results: WorktreeActionResult[];
};
