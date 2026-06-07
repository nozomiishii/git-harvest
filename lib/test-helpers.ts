import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type Repo = {
  [Symbol.asyncDispose]: () => Promise<void>;
  commit: (message: string) => Promise<void>;
  commitFile: (name: string, content: string, message: string) => Promise<void>;
  dir: string;
  git: (...args: string[]) => Promise<string>;
};

// `await using repo = await makeRepo()` でスコープ離脱時に自動削除
export async function makeRepo(): Promise<Repo> {
  const dir = mkdtempSync(path.join(tmpdir(), "git-harvest-test-"));
  const git = async (...args: string[]): Promise<string> => {
    const result = await exec("git", args, { cwd: dir });

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
