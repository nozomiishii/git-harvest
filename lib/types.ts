// commit ライフサイクルの ladder（危険 → 安全）。
export type Stage = 'committed' | 'files-changed' | 'merged';

// 危険 → 安全の順。閾値比較の index に使う。
export const SAFETY: readonly Stage[] = ['files-changed', 'committed', 'merged'];

// 1 リソース（worktree / branch）の処理結果。name は worktree=path / branch=branch 名。
export type ActionResult =
  | { action: 'failed'; error: string; name: string; }
  | { action: 'kept'; name: string; reason: string }
  | { action: 'removed'; name: string; }
  | { action: 'would-remove'; name: string; };

// branch を base に対して分類した結果。
//   untouched = 独自コミットなし（base の first-parent 線上）
//   merged    = 内容が base に取り込み済み（ancestor / 仮想 squash / cherry-pick）
//   other     = base に未取り込みの独自コミットあり
export type Classification = 'merged' | 'other' | 'untouched';

export type CleanupResult = {
  failures: number; // action === 'failed' の件数
  results: ActionResult[];
};

// 各 scope の削除設定。flag が閾値を下げる。default は全 scope merged。
export type Flags = {
  branch: Stage;                    // branch の閾値（branch に files-changed は無い）
  claudeWorktree: Stage;            // .claude/worktrees/ 配下の閾値
  claudeWorktreeDetached: boolean;  // detached な claude worktree を消すか
  claudeWorktreeUntouched: boolean; // untouched な claude worktree を消すか
  dryRun: boolean;                  // 削除せず予測のみ出力
  worktree: Stage;                  // 通常 path worktree の閾値
  worktreeDetached: boolean;        // detached な通常 worktree を消すか
  worktreeUntouched: boolean;       // untouched な通常 worktree を消すか
  yes: boolean;                     // 非対話で危険操作を許可（--yolo の前提）
};

// stage が閾値以降（threshold を含むそれより安全側）か。true なら削除対象。
export function atOrSafer(stage: Stage, threshold: Stage): boolean {
  return SAFETY.indexOf(stage) >= SAFETY.indexOf(threshold);
}
