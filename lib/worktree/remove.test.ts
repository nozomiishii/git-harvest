import { expect, test } from "vitest";
import type { WtRecord } from "./list";
import {
  removeCommitted,
  removeDetached,
  removeFilesChanged,
  removeMerged,
  removeUntouched,
} from "./remove";

function wtRecord(over: Partial<WtRecord> = {}): WtRecord {
  return { branch: "feature", locked: false, path: "/repo/wt", realpath: "/repo/wt", ...over };
}

// merged worktree はどの scope でも常に削除対象（dry-run で would-remove）
test("removeMerged marks a merged worktree for removal", async () => {
  const worktree = wtRecord();

  const result = await removeMerged(worktree, true, {});

  expect(result).toStrictEqual({ action: "would-remove", branch: "feature", path: worktree.path });
});

// committed worktree は --committed が無ければ理由付きで残す
test("removeCommitted keeps a committed worktree without the committed flag", async () => {
  const worktree = wtRecord();

  const result = await removeCommitted(worktree, false, true, {});

  expect(result).toStrictEqual({
    action: "kept",
    branch: "feature",
    message: "committed",
    path: worktree.path,
  });
});

// committed worktree は --committed があれば削除対象
test("removeCommitted marks a committed worktree for removal with the committed flag", async () => {
  const worktree = wtRecord();

  const result = await removeCommitted(worktree, true, true, {});

  expect(result).toStrictEqual({ action: "would-remove", branch: "feature", path: worktree.path });
});

// files-changed worktree は --files-changed が無ければ理由付きで残す
test("removeFilesChanged keeps a files-changed worktree without the files-changed flag", async () => {
  const worktree = wtRecord();

  const result = await removeFilesChanged(worktree, false, true, {});

  expect(result).toStrictEqual({
    action: "kept",
    branch: "feature",
    message: "files-changed",
    path: worktree.path,
  });
});

// untouched worktree は --untouched が無ければ理由付きで残す
test("removeUntouched keeps an untouched worktree without the flag", async () => {
  const worktree = wtRecord();

  const result = await removeUntouched(worktree, false, true, {});

  expect(result).toStrictEqual({
    action: "kept",
    branch: "feature",
    message: "untouched",
    path: worktree.path,
  });
});

// untouched worktree は --untouched があれば削除対象
test("removeUntouched marks an untouched worktree for removal with the flag", async () => {
  const worktree = wtRecord();

  const result = await removeUntouched(worktree, true, true, {});

  expect(result).toStrictEqual({ action: "would-remove", branch: "feature", path: worktree.path });
});

// detached worktree は --detached が無ければ理由付きで残す
test("removeDetached keeps a detached worktree without the flag", async () => {
  const worktree = wtRecord({ branch: undefined });

  const result = await removeDetached(worktree, false, true, {});

  expect(result).toStrictEqual({
    action: "kept",
    branch: undefined,
    message: "detached",
    path: worktree.path,
  });
});

// detached worktree は --detached があれば削除対象
test("removeDetached marks a detached worktree for removal with the flag", async () => {
  const worktree = wtRecord({ branch: undefined });

  const result = await removeDetached(worktree, true, true, {});

  expect(result).toStrictEqual({ action: "would-remove", branch: undefined, path: worktree.path });
});
