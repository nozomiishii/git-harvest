import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { defaultFlags } from "./flags";
import { makeRepo } from "./test-helpers";
import {
  categorize,
  cleanupWorktrees,
  keepReason,
  removeForScope,
  sweepOffLadder,
  type WtRecord,
} from "./worktree";

function wtRecord(over: Partial<WtRecord> = {}): WtRecord {
  return { branch: "feature", canon: "/repo/wt", locked: false, path: "/repo/wt", ...over };
}

// locked worktree はどのフラグでも消さず、理由 "locked" を返す
test("keepReason protects a locked worktree and surfaces the reason", () => {
  expect(keepReason(wtRecord({ locked: true }), "main", "/elsewhere")).toBe("locked");
});

// merged worktree は default フラグで削除対象（dry-run で would-remove）
test("removeForScope removes a merged worktree by default", async () => {
  const worktree = wtRecord();

  const results = await removeForScope(
    [{ category: "merged", worktree }],
    defaultFlags().worktree,
    true,
  );

  expect(results.some((r) => r.action === "would-remove" && r.name === worktree.path)).toBe(true);
});

// committed worktree は default で保護（reason=committed）
test("removeForScope keeps a committed worktree by default", async () => {
  const worktree = wtRecord();

  const results = await removeForScope(
    [{ category: "committed", worktree }],
    defaultFlags().worktree,
    true,
  );

  expect(results).toStrictEqual([{ action: "kept", name: worktree.path, reason: "committed" }]);
});

// committed フラグ（--committed=claude-worktree 相当）が立つと committed worktree を削除
test("removeForScope removes a committed worktree when the committed flag is set", async () => {
  const worktree = wtRecord();

  const results = await removeForScope(
    [{ category: "committed", worktree }],
    { committed: true, filesChanged: false },
    true,
  );

  expect(results.some((r) => r.action === "would-remove" && r.name === worktree.path)).toBe(true);
});

// files-changed（未コミット）worktree は default で保護
test("removeForScope keeps a files-changed worktree by default", async () => {
  const worktree = wtRecord();

  const results = await removeForScope(
    [{ category: "files-changed", worktree }],
    defaultFlags().worktree,
    true,
  );

  expect(results).toStrictEqual([{ action: "kept", name: worktree.path, reason: "files-changed" }]);
});

// untouched worktree は toggle 無しで保護（reason=untouched）
test("sweepOffLadder keeps an untouched worktree without the toggle", async () => {
  const worktree = wtRecord();

  const result = await sweepOffLadder(worktree, false, "untouched", true);

  expect(result).toStrictEqual({ action: "kept", name: worktree.path, reason: "untouched" });
});

// --untouched toggle で untouched worktree を削除
test("sweepOffLadder removes an untouched worktree with the toggle", async () => {
  const worktree = wtRecord();

  const result = await sweepOffLadder(worktree, true, "untouched", true);

  expect(result).toStrictEqual({ action: "would-remove", name: worktree.path });
});

// detached worktree は toggle 無しで保護（reason=detached）
test("sweepOffLadder keeps a detached worktree without the toggle", async () => {
  const worktree = wtRecord({ branch: undefined });

  const result = await sweepOffLadder(worktree, false, "detached", true);

  expect(result).toStrictEqual({ action: "kept", name: worktree.path, reason: "detached" });
});

// --detached toggle で detached worktree を削除
test("sweepOffLadder removes a detached worktree with the toggle", async () => {
  const worktree = wtRecord({ branch: undefined });

  const result = await sweepOffLadder(worktree, true, "detached", true);

  expect(result).toStrictEqual({ action: "would-remove", name: worktree.path });
});

// 未コミットの変更がある worktree は files-changed に分類（消すと復元できない最優先段）
test("categorize classifies a worktree with uncommitted changes as files-changed", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.git("switch", "main");
  const wtPath = `${repo.dir}-wip`;
  await repo.git("worktree", "add", wtPath, "wip");
  writeFileSync(path.join(wtPath, "dirty.txt"), "x");

  try {
    const worktree = wtRecord({ branch: "wip", path: wtPath });

    expect(await categorize(worktree, "main", { cwd: repo.dir })).toBe("files-changed");
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
  }
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

// ディレクトリが消えた prunable worktree は表示にも生存にも含めず、その branch を同じ実行で回収可能にする
test("cleanupWorktrees skips a worktree whose directory was deleted", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commit("done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  const wtPath = `${repo.dir}-done`;
  await repo.git("worktree", "add", wtPath, "done");
  rmSync(wtPath, { force: true, recursive: true });

  const result = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });

  expect(result.results).toStrictEqual([]);
  expect(result.survivingBranches.has("done")).toBe(false);
});

// clean でも submodule を含む worktree は git の最終検証（非 force）が拒否し、failed で残る（誤削除防止）
test("cleanupWorktrees refuses to remove a clean worktree containing a submodule", async () => {
  await using repo = await makeRepo();
  const subPath = `${repo.dir}-sub`;
  mkdirSync(subPath);
  await repo.git("-C", subPath, "init", "-b", "main");
  await repo.git("-C", subPath, "config", "user.email", "test@example.com");
  await repo.git("-C", subPath, "config", "user.name", "Test");
  await repo.git("-C", subPath, "commit", "--allow-empty", "-m", "sub init");
  await repo.git("switch", "-c", "done");
  await repo.git("switch", "main");
  const wtPath = `${repo.dir}-done`;
  await repo.git("worktree", "add", wtPath, "done");

  try {
    await repo.git(
      "-C",
      wtPath,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      subPath,
      "mysub",
    );
    await repo.git("-C", wtPath, "commit", "-m", "add submodule");
    await repo.git("merge", "--no-ff", "done", "-m", "merge done");

    const result = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });

    expect(
      result.results.some((r) => r.action === "failed" && r.name === realpathSync(wtPath)),
    ).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
    rmSync(subPath, { force: true, recursive: true });
  }
});

// 生存 worktree（main + kept）の branch 名を返す。削除された worktree の branch は含まない
test("cleanupWorktrees reports the branches of surviving worktrees", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commit("done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  await repo.git("branch", "wip");
  const doneWt = `${repo.dir}-done`;
  const wipWt = `${repo.dir}-wip`;
  await repo.git("worktree", "add", doneWt, "done");
  await repo.git("worktree", "add", wipWt, "wip");

  try {
    // done worktree は merged で削除、wip worktree は untouched で kept
    const result = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });

    expect(result.survivingBranches).toStrictEqual(new Set(["main", "wip"]));
  } finally {
    rmSync(wipWt, { force: true, recursive: true });
  }
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
