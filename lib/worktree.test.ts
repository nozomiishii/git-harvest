import { mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { defaultFlags } from "./flags";
import { makeRepo } from "./test-helpers";
import { cleanupWorktrees, decideWorktree, type WorktreeInfo } from "./worktree";

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

// invariant は yolo でも保護し、generic な protected でなく「残した理由」をそのまま reason に返す
test("decideWorktree keeps an invariant worktree even under yolo and surfaces the reason", () => {
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

  const result = decideWorktree(wt({ invariantReason: "locked" }), yolo);

  if (result.remove) {
    throw new Error("expected kept");
  }

  expect(result.reason).toBe("locked");
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

// main にマージ済みの linked worktree は default で削除
test("cleanupWorktrees removes a merged linked worktree by default", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commit("done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  const wtPath = `${repo.dir}-done`;
  await repo.git("worktree", "add", wtPath, "done");
  // git は porcelain で realpath を返すため canonical 同士で比較する（macOS の /private symlink 対策）
  const canonWt = realpathSync(wtPath);

  const result = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });

  expect(result.results.some((r) => r.action === "removed" && r.name === canonWt)).toBe(true);
});

// cwd が worktree のサブディレクトリでも current invariant で保護（post-merge hook はサブディレクトリで動く）
test("cleanupWorktrees keeps the worktree containing cwd even from a subdirectory", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commit("done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  const wtPath = `${repo.dir}-done`;
  await repo.git("worktree", "add", wtPath, "done");
  const sub = path.join(wtPath, "sub");
  mkdirSync(sub);

  try {
    const result = await cleanupWorktrees("main", defaultFlags(), { cwd: sub });

    expect(result.results.some((r) => r.action === "kept" && r.reason === "current")).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
  }
});
