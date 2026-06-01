import type { Flags } from './types';

// default（bare git-harvest）: 保守的。全 scope の閾値 merged のみ削除し、
// detached / untouched は保護、dryRun / yes は false。
export function defaultFlags(): Flags {
  return {
    branch: 'merged',
    claudeWorktree: 'merged',
    claudeWorktreeDetached: false,
    claudeWorktreeUntouched: false,
    dryRun: false,
    worktree: 'merged',
    worktreeDetached: false,
    worktreeUntouched: false,
    yes: false,
  };
}

// --yolo: invariant 以外を全部消す土台。
// worktree / claudeWorktree は files-changed（未コミット込み全削除）、branch は committed（branch は files-changed なし）。
// detached / untouched 4 boolean は true。dryRun / yes は false（yes は cli 側で別途反映）。
export function yoloFlags(): Flags {
  return {
    branch: 'committed',
    claudeWorktree: 'files-changed',
    claudeWorktreeDetached: true,
    claudeWorktreeUntouched: true,
    dryRun: false,
    worktree: 'files-changed',
    worktreeDetached: true,
    worktreeUntouched: true,
    yes: false,
  };
}
