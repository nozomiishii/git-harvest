import { expect, test } from "vitest";
import { defaultFlags } from "./flags";
import { decideWorktree, type WorktreeInfo } from "./worktree";

function wt(over: Partial<WorktreeInfo>): WorktreeInfo {
  return {
    hasBranch: true,
    hasUncommittedChanges: false,
    invariantReason: undefined,
    isMerged: false,
    isUntouched: false,
    path: "/repo/.claude/worktrees/x",
    ...over,
  };
}

// invariant は yolo でも保護
test("decideWorktree keeps an invariant worktree even under yolo", () => {
  const yolo = {
    detached: true,
    dryRun: false,
    thresholds: {
      branch: "committed",
      "claude-worktree": "files-changed",
      worktree: "files-changed",
    },
    untouched: true,
  } as const;

  expect(decideWorktree(wt({ invariantReason: "locked" }), yolo).remove).toBe(false);
});

// invariant は generic な protected でなく「残した理由」をそのまま reason に返す
test("decideWorktree surfaces the invariant reason instead of a generic label", () => {
  const result = decideWorktree(wt({ invariantReason: "session running" }), defaultFlags());

  if (result.remove) {
    throw new Error("expected kept");
  }

  expect(result.reason).toBe("session running");
});

// merged は default で削除
test("decideWorktree removes a merged worktree by default", () => {
  expect(decideWorktree(wt({ isMerged: true }), defaultFlags()).remove).toBe(true);
});

// committed は default で保護
test("decideWorktree keeps a committed worktree by default", () => {
  expect(decideWorktree(wt({ isMerged: false }), defaultFlags()).remove).toBe(false);
});

// --committed=claude-worktree で committed な claude worktree を削除
test("decideWorktree removes a committed claude worktree under --committed=claude-worktree", () => {
  const flags = {
    ...defaultFlags(),
    thresholds: { ...defaultFlags().thresholds, "claude-worktree": "committed" as const },
  };

  expect(decideWorktree(wt({ isMerged: false }), flags).remove).toBe(true);
});

// untouched は default で保護
test("decideWorktree keeps untouched by default", () => {
  expect(decideWorktree(wt({ isUntouched: true }), defaultFlags()).remove).toBe(false);
});

// --untouched toggle で untouched を削除
test("decideWorktree removes untouched with the untouched toggle", () => {
  expect(
    decideWorktree(wt({ isUntouched: true }), { ...defaultFlags(), untouched: true }).remove,
  ).toBe(true);
});

// detached は default で保護
test("decideWorktree keeps detached by default", () => {
  expect(decideWorktree(wt({ hasBranch: false }), defaultFlags()).remove).toBe(false);
});

// --detached toggle で detached を削除
test("decideWorktree removes detached with the detached toggle", () => {
  expect(
    decideWorktree(wt({ hasBranch: false }), { ...defaultFlags(), detached: true }).remove,
  ).toBe(true);
});

// 未コミット変更は files-changed 扱いで default 保護
test("decideWorktree treats uncommitted changes as files-changed and keeps them by default", () => {
  expect(
    decideWorktree(wt({ hasUncommittedChanges: true, isMerged: true }), defaultFlags()).remove,
  ).toBe(false);
});
