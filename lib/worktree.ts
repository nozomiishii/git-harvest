import type { CleanupDecisionResult, Flags, Stage } from "./types";
import { scopeOfPath } from "./agent";
import { atOrSafer } from "./types";

export type WorktreeInfo = {
  hasBranch: boolean;
  hasUncommittedChanges: boolean;
  invariantReason: string | undefined;
  isMerged: boolean;
  isUntouched: boolean;
  path: string;
};

// yolo は flags に展開済みなので判定に yolo 分岐は無い
export function decideWorktree(info: WorktreeInfo, flags: Flags): CleanupDecisionResult {
  if (info.invariantReason) {
    return { reason: info.invariantReason, remove: false };
  }

  if (!info.hasBranch) {
    return flags.detached ? { remove: true } : { reason: "detached", remove: false };
  }

  if (info.isUntouched) {
    return flags.untouched ? { remove: true } : { reason: "untouched", remove: false };
  }
  const stage = worktreeStage(info);
  const threshold = flags.thresholds[scopeOfPath(info.path)];

  return atOrSafer(stage, threshold) ? { remove: true } : { reason: stage, remove: false };
}

function worktreeStage(info: WorktreeInfo): Stage {
  if (info.hasUncommittedChanges) {
    return "files-changed";
  }

  if (info.isMerged) {
    return "merged";
  }

  return "committed";
}
