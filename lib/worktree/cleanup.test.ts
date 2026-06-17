import { mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { defaultFlags } from "../flags/parse";
import { makeRepo } from "../testing/repo";
import type { Flags } from "../types";
import { cleanupWorktrees } from "./cleanup";

// locked worktree はどのフラグでも守る（merged でも message=locked で kept）
test("cleanupWorktrees keeps a locked worktree even under aggressive flags", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commit("done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  const wtPath = `${repo.dir}-done`;
  await repo.git("worktree", "add", wtPath, "done");
  await repo.git("worktree", "lock", wtPath);

  try {
    const flags: Flags = { ...defaultFlags(), committed: ["worktree"], filesChanged: ["worktree"] };
    const result = await cleanupWorktrees("main", flags, { cwd: repo.dir });

    expect(result.results.some((r) => r.action === "kept" && r.message === "locked")).toBe(true);
  } finally {
    await repo.git("worktree", "unlock", wtPath).catch(() => "");
    rmSync(wtPath, { force: true, recursive: true });
  }
});

// ladder cascade: --files-changed は committed worktree も巻き込む（より安全な段なので）
test("cleanupWorktrees marks a committed worktree with --files-changed alone", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commit("unmerged work");
  await repo.git("switch", "main");
  const wtPath = `${repo.dir}-wip`;
  await repo.git("worktree", "add", wtPath, "wip");
  const canonWt = realpathSync(wtPath);

  try {
    const flags: Flags = { ...defaultFlags(), dryRun: true, filesChanged: ["worktree"] };
    const result = await cleanupWorktrees("main", flags, { cwd: repo.dir });

    expect(result.results).toContainEqual({
      action: "would-remove",
      branch: "wip",
      path: canonWt,
    });
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
  // git は porcelain で realpath を返すため realpath 同士で比較する（macOS の /private symlink 対策）
  const canonWt = realpathSync(wtPath);

  const result = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });

  expect(result.results.some((r) => r.action === "removed" && r.path === canonWt)).toBe(true);
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
      result.results.some((r) => r.action === "failed" && r.path === realpathSync(wtPath)),
    ).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
    rmSync(subPath, { force: true, recursive: true });
  }
});

// 生き残った worktree は branch 付きで kept として出る（branch 掃除がここから checkout 中の branch を保護）
test("cleanupWorktrees keeps a surviving worktree with its branch", async () => {
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
    // done worktree は merged で削除、wip worktree は untouched で生き残る
    const result = await cleanupWorktrees("main", defaultFlags(), { cwd: repo.dir });

    expect(result.results).toContainEqual({
      action: "kept",
      branch: "wip",
      message: "untouched",
      path: realpathSync(wipWt),
    });
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

    expect(result.results.some((r) => r.action === "kept" && r.message === "current")).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
  }
});
