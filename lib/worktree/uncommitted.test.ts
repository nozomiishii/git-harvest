import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { makeRepo } from "../testing/repo";
import { hasUncommittedChanges } from "./uncommitted";

// 未コミットの変更がある worktree は hasUncommittedChanges が true（files-changed 判定の根拠）
test("hasUncommittedChanges is true when a worktree has uncommitted changes", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.git("switch", "main");
  const wtPath = `${repo.dir}-wip`;
  await repo.git("worktree", "add", wtPath, "wip");
  writeFileSync(path.join(wtPath, "dirty.txt"), "x");

  try {
    expect(await hasUncommittedChanges(wtPath)).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
  }
});

// status.showUntrackedFiles=no 設定下でも未追跡ファイルを数える（config 非依存）
test("hasUncommittedChanges detects untracked files even when showUntrackedFiles is off", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.git("switch", "main");
  const wtPath = `${repo.dir}-wip`;
  await repo.git("worktree", "add", wtPath, "wip");
  await repo.git("-C", wtPath, "config", "status.showUntrackedFiles", "no");
  writeFileSync(path.join(wtPath, "dirty.txt"), "x");

  try {
    expect(await hasUncommittedChanges(wtPath)).toBe(true);
  } finally {
    rmSync(wtPath, { force: true, recursive: true });
  }
});
