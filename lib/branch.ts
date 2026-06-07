import type { Classification, CleanupDecisionResult, Flags, Stage } from "./types";
import { atOrSafer } from "./types";

export type BranchInfo = {
  classification: Classification;
  invariantReason: string | undefined;
  name: string;
};

export function decideBranch(info: BranchInfo, flags: Flags): CleanupDecisionResult {
  if (info.invariantReason) {
    return { reason: info.invariantReason, remove: false };
  }
  const stage = branchStage(info.classification);

  return atOrSafer(stage, flags.thresholds.branch)
    ? { remove: true }
    : { reason: stage, remove: false };
}

function branchStage(c: Classification): Stage {
  return c === "other" ? "committed" : "merged";
}
