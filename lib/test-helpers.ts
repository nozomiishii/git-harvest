import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { promisify } from "node:util";
import type { CleanupDecisionResult } from "./types";

const exec = promisify(execFile);

export type Repo = {
  [Symbol.asyncDispose]: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  commitFile: (name: string, content: string, message: string) => Promise<void>;
  dir: string;
  git: (...args: string[]) => Promise<string>;
};

// kept 側へ型を絞る assertion。「残すなら必ず reason がある」union を保ったままテストで reason を読める
export function assertKept(
  result: CleanupDecisionResult,
): asserts result is Extract<CleanupDecisionResult, { remove: false }> {
  if (result.remove) {
    throw new Error("expected kept");
  }
}

// `await using repo = await makeRepo()` でスコープ離脱時に自動削除
export async function makeRepo(): Promise<Repo> {
  const dir = mkdtempSync(path.join(tmpdir(), "git-harvest-test-"));
  // 各 git 呼び出しに一意なタイムスタンプを付与し、cherry-pick が同一 SHA になるのを防ぐ
  let timestamp = 1_000_000_000;
  const git = async (...args: string[]): Promise<string> => {
    const date = String(timestamp);

    timestamp += 60;

    const result = await exec("git", args, {
      cwd: dir,
      env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });

    return result.stdout.trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  const commit = async (message: string): Promise<void> => {
    await git("commit", "--allow-empty", "-m", message);
  };
  const commitFile = async (name: string, content: string, message: string): Promise<void> => {
    writeFileSync(path.join(dir, name), content);
    await git("add", name);
    await git("commit", "-m", message);
  };
  await commit("init");
  await git("remote", "add", "origin", dir);
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

  return {
    commit,
    commitFile,
    dir,
    git,
    [Symbol.asyncDispose]: () => {
      rmSync(dir, { force: true, recursive: true });

      return Promise.resolve();
    },
  };
}
