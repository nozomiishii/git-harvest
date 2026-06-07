import { expect, test } from "vitest";
import { type BranchInfo, decideBranch } from "./branch";
import { defaultFlags } from "./flags";

function br(over: Partial<BranchInfo>): BranchInfo {
  return { classification: "other", invariantReason: undefined, name: "feature", ...over };
}

// invariant branch は理由をそのまま reason に返す
test("decideBranch keeps an invariant branch and surfaces its reason", () => {
  const result = decideBranch(br({ invariantReason: "current HEAD" }), defaultFlags());

  if (result.remove) {
    throw new Error("expected kept");
  }

  expect(result.reason).toBe("current HEAD");
});

// merged は in-base として default 削除
test("decideBranch removes a merged branch as in-base by default", () => {
  expect(decideBranch(br({ classification: "merged" }), defaultFlags()).remove).toBe(true);
});

// untouched も in-base として default 削除
test("decideBranch removes an untouched branch as in-base by default", () => {
  expect(decideBranch(br({ classification: "untouched" }), defaultFlags()).remove).toBe(true);
});

// committed（other）な branch は default で保護
test("decideBranch keeps a committed branch by default", () => {
  expect(decideBranch(br({ classification: "other" }), defaultFlags()).remove).toBe(false);
});

// committed 閾値で committed な branch を削除
test("decideBranch removes a committed branch at the committed threshold", () => {
  const flags = {
    ...defaultFlags(),
    thresholds: { ...defaultFlags().thresholds, branch: "committed" as const },
  };

  expect(decideBranch(br({ classification: "other" }), flags).remove).toBe(true);
});
