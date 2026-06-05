import { execSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "git-harvest");

// Claude 関連パスを空ディレクトリに向けて、ユーザーの実 ~/.claude を見ないように隔離する
const TEST_CLAUDE_SESSIONS_DIR = mkdtempSync(path.join(tmpdir(), "git-harvest-claude-sessions-"));
// execSync(bash) で子プロセスに必要な env だけ継承する（PATH: bash/git/sleep の実行、HOME: git 設定と $HOME 展開）。
// TODO: 本体を TS 化したら #180 のように関数を直接呼ぶ unit test にし、execSync(bash) と env 継承を無くしてリファクタする。
const TEST_ENV = {
  GIT_HARVEST_CLAUDE_SESSIONS_DIR: TEST_CLAUDE_SESSIONS_DIR,
  HOME: process.env.HOME,
  NO_COLOR: "1",
  PATH: process.env.PATH,
};

// ヘルパー: ブランチ一覧を取得
function branches(cwd: string): string[] {
  return execSync("git branch", { cwd, encoding: "utf8" })
    .split("\n")
    .map((b) => b.replace(/^[*+ ]+/, "").trim())
    .filter(Boolean);
}

// ヘルパー: ファイルを作成してコミット
function commitFile(cwd: string, filename: string, message: string): void {
  writeFileSync(path.join(cwd, filename), `${filename}: ${message}\n`);
  git(cwd, `add ${filename}`);
  git(cwd, `commit -m "${message}"`);
}

// ヘルパー: git コマンド実行（テスト環境ではコミット署名を無効化）
function git(cwd: string, args: string): string {
  return execSync(`git -c commit.gpgsign=false ${args}`, { cwd, encoding: "utf8", stdio: "pipe" });
}

// ヘルパー: スクリプト実行（NO_COLOR=1 で ANSI エスケープを無効化）
function run(cwd: string, args = ""): string {
  return execSync(`bash ${SCRIPT} ${args}`, {
    cwd,
    encoding: "utf8",
    env: TEST_ENV,
    stdio: "pipe",
  });
}

// ヘルパー: スクリプト実行（失敗を期待）
function runExpectFail(cwd: string, args = ""): { status: number; stderr: string } {
  try {
    execSync(`bash ${SCRIPT} ${args}`, { cwd, encoding: "utf8", env: TEST_ENV, stdio: "pipe" });

    return { status: 0, stderr: "" };
  } catch (error: unknown) {
    const err = error as { status: number; stderr: string };

    return { status: err.status, stderr: err.stderr };
  }
}

// ヘルパー: origin 付きリポジトリを作成し、using で破棄する
function setupRepo(): { [Symbol.dispose]: () => void; bare: string; repo: string } {
  const bare = mkdtempSync(path.join(tmpdir(), "git-harvest-bare-"));
  execSync(`git init --bare -b main ${bare}`);
  const repo = mkdtempSync(path.join(tmpdir(), "git-harvest-work-"));
  execSync(`git clone ${bare} ${repo}`);
  git(repo, 'config user.email "test@test.com"');
  git(repo, 'config user.name "Test"');
  commitFile(repo, "README.md", "init");
  git(repo, "push");

  return {
    bare,
    repo,
    [Symbol.dispose]() {
      // worktree は repo 外のディレクトリに作られるため、repo の rmSync では削除されない。先に除去する。
      try {
        const wts = worktrees(repo);

        for (const wt of wts) {
          if (wt !== repo) {
            // locked worktree はテスト失敗時に残りうるため、unlock してから -f -f で除去する
            try {
              git(repo, `worktree unlock ${wt}`);
            } catch {
              // ignore (ロックされていない場合)
            }

            try {
              git(repo, `worktree remove --force --force ${wt}`);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
      rmSync(bare, { force: true, recursive: true });
      rmSync(repo, { force: true, recursive: true });
    },
  };
}

// ヘルパー: sleep プロセスを spawn し、pid（spawn 成功時は必ず付く）を number で返す
function spawnLiveSession(): { pid: number; proc: ReturnType<typeof spawn> } {
  const proc = spawn("sleep", ["60"], { detached: false });

  if (proc.pid === undefined) {
    throw new Error("spawn failed to assign a pid");
  }

  return { pid: proc.pid, proc };
}

// ヘルパー: worktree 一覧を取得
function worktrees(cwd: string): string[] {
  return execSync("git worktree list --porcelain", { cwd, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.replace("worktree ", ""));
}

describe("--help / --version", () => {
  // ヘルプ表示（--all を含む）
  test("prints help and exits with 0", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    const output = run(repo, "--help");

    expect(output).toContain("Usage: git-harvest");
    expect(output).toContain("--help");
    expect(output).toContain("--version");
    expect(output).toContain("--all");
  });

  // バージョン表示
  test("prints version and exits with 0", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    const output = run(repo, "--version");

    expect(output).toMatch(/^git-harvest v\d+\.\d+\.\d+/);
  });
});

describe("default_branch", () => {
  // origin/HEAD 設定済み
  test("resolves default branch from origin/HEAD", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    expect(() => run(repo)).not.toThrow();
  });

  // origin/HEAD 未設定 → 自動復旧
  test("recovers via set-head --auto when origin/HEAD is unset", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "remote set-head origin -d");

    expect(() => run(repo)).not.toThrow();
  });

  // remote なし → 異常終了
  test("exits with 1 when no remote is configured", () => {
    using _ctx = setupRepo();

    const noRemoteRepo = mkdtempSync(path.join(tmpdir(), "git-harvest-noremote-"));

    try {
      execSync(`git init ${noRemoteRepo}`);
      git(noRemoteRepo, 'config user.email "test@test.com"');
      git(noRemoteRepo, 'config user.name "Test"');
      git(noRemoteRepo, 'commit --allow-empty -m "init"');

      const result = runExpectFail(noRemoteRepo);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Could not determine default branch");
    } finally {
      rmSync(noRemoteRepo, { force: true, recursive: true });
    }
  });
});

describe("merge detection", () => {
  // 通常マージ済み
  test("detects and deletes regular merged branches", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feature-regular");
    commitFile(repo, "feature-regular.txt", "feature work");
    git(repo, "checkout main");
    git(repo, "merge feature-regular --no-ff -m 'merge feature'");
    git(repo, "push");

    const output = run(repo);

    expect(branches(repo)).not.toContain("feature-regular");
    expect(branches(repo)).toContain("main");
    expect(output).toContain("✓");
    expect(output).toContain("feature-regular");
    expect(output).toContain("Harvested");
  });

  // squash マージ済み
  test("detects and deletes squash-merged branches", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feature-squash");
    commitFile(repo, "squash1.txt", "squash work 1");
    commitFile(repo, "squash2.txt", "squash work 2");
    git(repo, "checkout main");
    git(repo, "merge --squash feature-squash");
    git(repo, 'commit -m "squash merge feature"');
    git(repo, "push");

    const output = run(repo);

    expect(branches(repo)).not.toContain("feature-squash");
    expect(branches(repo)).toContain("main");
    expect(output).toContain("✓");
    expect(output).toContain("feature-squash");
    expect(output).toContain("Harvested");
  });

  // マージ済みでもチェックアウト中のブランチは保持
  test("preserves merged branch that is currently checked out", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feature-checkedout");
    commitFile(repo, "checkedout.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash feature-checkedout");
    git(repo, 'commit -m "squash merge checkedout"');
    git(repo, "push");

    // マージ済みブランチに戻ってそこから実行
    git(repo, "checkout feature-checkedout");
    const output = run(repo);

    expect(branches(repo)).toContain("feature-checkedout");
    expect(output).toContain("·");
    expect(output).toContain("currently checked out");
  });

  // 未マージは保持し · not merged を表示
  test("preserves unmerged branches and shows GROWING status", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feature-wip");
    commitFile(repo, "wip.txt", "wip");
    git(repo, "checkout main");

    const output = run(repo);

    expect(branches(repo)).toContain("feature-wip");
    expect(output).toContain("·");
    expect(output).toContain("feature-wip");
    expect(output).toContain("not merged");
  });

  // マージ済みなし → Nothing to harvest メッセージ
  test("exits with 0 and shows nothing-to-harvest message when no merged branches exist", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    const output = run(repo);

    expect(branches(repo)).toStrictEqual(["main"]);
    expect(output).toContain("Nothing to harvest. All clean.");
  });

  // 独自コミットなしのブランチは削除する
  test("deletes branches with no unique commits", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b no-commits-yet");
    git(repo, "checkout main");

    const output = run(repo);

    expect(branches(repo)).not.toContain("no-commits-yet");
    expect(output).toContain("✓");
    expect(output).toContain("no-commits-yet");
  });

  // main より古いコミットを指す独自コミットなしブランチも削除
  test("deletes branches pointing to older commits with no unique work", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b old-branch");
    git(repo, "checkout main");
    // main を先に進める
    commitFile(repo, "advance.txt", "advance main");
    git(repo, "push");

    run(repo);

    expect(branches(repo)).not.toContain("old-branch");
  });

  // 孤立ブランチはスキップ
  test("skips orphan branches without common ancestor", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout --orphan isolated");
    commitFile(repo, "orphan.txt", "orphan commit");
    git(repo, "checkout main");

    run(repo);

    expect(branches(repo)).toContain("isolated");
  });

  // cherry-pick フォールバック: 履歴書き換え後の orphaned ブランチをマージ済みと検出
  test("detects merged orphaned branches via cherry-pick fallback after history rewrite", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // feature ブランチでコミット
    git(repo, "checkout -b feature-orphaned");
    commitFile(repo, "feature.txt", "feature work");
    git(repo, "checkout main");

    // main に cherry-pick で同じ変更を取り込む
    const featureHead = git(repo, "rev-parse feature-orphaned").trim();
    git(repo, `cherry-pick ${featureHead}`);
    git(repo, "push");

    // main の履歴を新しいルートから再構築（commit-tree で同じツリーを持つ新コミットを作成）
    // これにより feature-orphaned と共通祖先を持たないが patch-id が一致する状態になる
    const initTree = git(repo, "rev-parse HEAD~1^{tree}").trim();
    const newInit = git(repo, `commit-tree ${initTree} -m "init"`).trim();
    const mainTree = git(repo, "rev-parse HEAD^{tree}").trim();
    const newMain = git(repo, `commit-tree ${mainTree} -p ${newInit} -m "feature work"`).trim();
    git(repo, `checkout -B main ${newMain}`);
    git(repo, "push --force origin main");

    const output = run(repo);

    expect(branches(repo)).not.toContain("feature-orphaned");
    expect(output).toContain("✓");
    expect(output).toContain("feature-orphaned");
  });
});

describe("worktree cleanup", () => {
  // マージ済み worktree を削除
  test("removes worktrees for merged branches", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-merged");
    commitFile(repo, "wt-merged.txt", "wt work");
    git(repo, "checkout main");
    git(repo, "merge --squash wt-merged");
    git(repo, 'commit -m "squash merge wt"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "wt-merged-dir");
    git(repo, `worktree add ${wtDir} wt-merged`);

    expect(worktrees(repo).length).toBeGreaterThan(1);

    const output = run(repo);

    expect(branches(repo)).not.toContain("wt-merged");
    expect(worktrees(repo)).toHaveLength(1);
    expect(output).toContain("✓");
    expect(output).toContain("Harvested");
  });

  // default branch の worktree は保持
  test("preserves worktree on default branch", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // main の worktree を追加するため、まず別ブランチに退避
    git(repo, "checkout -b temp-branch");
    const wtDir = path.join(repo, "..", "wt-main-dir");
    git(repo, `worktree add ${wtDir} main`);

    // temp-branch から実行（main は worktree にいる）
    const wtCountBefore = worktrees(repo).length;
    run(repo);

    expect(worktrees(repo)).toHaveLength(wtCountBefore);

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // マージ済みでも未コミット変更がある worktree は保持
  test("preserves merged worktree with uncommitted changes", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-uncommitted");
    commitFile(repo, "wt-uncommitted.txt", "committed work");
    git(repo, "checkout main");
    git(repo, "merge --squash wt-uncommitted");
    git(repo, 'commit -m "squash merge uncommitted"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "wt-uncommitted-dir");
    git(repo, `worktree add ${wtDir} wt-uncommitted`);
    // worktree 内に未コミットの変更を作成
    writeFileSync(path.join(wtDir, "dirty.txt"), "uncommitted change\n");

    const output = run(repo);

    expect(branches(repo)).toContain("wt-uncommitted");
    expect(worktrees(repo).length).toBeGreaterThan(1);
    expect(output).toContain("·");
    expect(output).toContain("uncommitted changes");

    // cleanup
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // 未マージ worktree は保持し · not merged を表示
  test("preserves worktrees for unmerged branches and shows GROWING status", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-unmerged");
    commitFile(repo, "wt-unmerged.txt", "unmerged work");
    git(repo, "checkout main");

    const wtDir = path.join(repo, "..", "wt-unmerged-dir");
    git(repo, `worktree add ${wtDir} wt-unmerged`);

    const output = run(repo);

    expect(branches(repo)).toContain("wt-unmerged");
    expect(worktrees(repo).length).toBeGreaterThan(1);
    expect(output).toContain("·");
    expect(output).toContain("not merged");

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // 独自コミットなしの worktree は保持し · no unique commits を表示
  test("preserves worktrees for branches with no unique commits and shows GROWING status", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    const wtDir = path.join(repo, "..", "wt-no-commits-dir");
    git(repo, `worktree add -b wt-no-commits ${wtDir}`);

    const output = run(repo);

    expect(branches(repo)).toContain("wt-no-commits");
    expect(worktrees(repo).length).toBeGreaterThan(1);
    expect(output).toContain("·");
    expect(output).toContain("no unique commits");

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // worktree なし → 正常通過
  test("succeeds when no worktrees exist", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feature-no-wt");
    commitFile(repo, "no-wt.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash feature-no-wt");
    git(repo, 'commit -m "squash"');
    git(repo, "push");

    run(repo);

    expect(branches(repo)).not.toContain("feature-no-wt");
  });

  // 手動削除済み worktree を prune
  test("prunes manually deleted worktree entries", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-prune");
    commitFile(repo, "wt-prune.txt", "prune work");
    git(repo, "checkout main");

    const wtDir = mkdtempSync(path.join(tmpdir(), "git-harvest-wt-prune-"));
    git(repo, `worktree add ${wtDir} wt-prune`);

    // worktree ディレクトリを手動で削除（git worktree remove ではなく）
    rmSync(wtDir, { force: true, recursive: true });

    run(repo);

    // prune 後は stale エントリが消えている（wt-prune ブランチは未マージなので残る）
    expect(branches(repo)).toContain("wt-prune");
  });
});

describe("combined scenarios", () => {
  // worktree + ブランチ両方削除
  test("removes both worktree and branch for merged work", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b combo-merged");
    commitFile(repo, "combo.txt", "combo work");
    git(repo, "checkout main");
    git(repo, "merge --squash combo-merged");
    git(repo, 'commit -m "squash combo"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "combo-wt-dir");
    git(repo, `worktree add ${wtDir} combo-merged`);

    const output = run(repo);

    expect(branches(repo)).not.toContain("combo-merged");
    expect(worktrees(repo)).toHaveLength(1);
    expect(output).toContain("✓");
    expect(output).toContain("Harvested");
  });

  // マージ済みと未マージの混在
  test("deletes only merged branches when mixed with unmerged", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b merged-one");
    commitFile(repo, "merged.txt", "merged work");
    git(repo, "checkout main");
    git(repo, "merge --squash merged-one");
    git(repo, 'commit -m "squash one"');
    git(repo, "push");

    git(repo, "checkout -b unmerged-one");
    commitFile(repo, "unmerged.txt", "unmerged work");
    git(repo, "checkout main");

    run(repo);

    expect(branches(repo)).not.toContain("merged-one");
    expect(branches(repo)).toContain("unmerged-one");
  });

  // master がデフォルトブランチ
  test("works when default branch is master", () => {
    using _ctx = setupRepo();

    const masterBare = mkdtempSync(path.join(tmpdir(), "git-harvest-master-bare-"));
    const masterRepo = mkdtempSync(path.join(tmpdir(), "git-harvest-master-work-"));

    try {
      execSync(`git init --bare -b master ${masterBare}`);
      execSync(`git clone ${masterBare} ${masterRepo}`);
      git(masterRepo, 'config user.email "test@test.com"');
      git(masterRepo, 'config user.name "Test"');
      commitFile(masterRepo, "README.md", "init");
      git(masterRepo, "push -u origin master");

      git(masterRepo, "checkout -b feature-on-master");
      commitFile(masterRepo, "feature.txt", "feature");
      git(masterRepo, "checkout master");
      git(masterRepo, "merge --squash feature-on-master");
      git(masterRepo, 'commit -m "squash"');
      git(masterRepo, "push");

      run(masterRepo);

      expect(branches(masterRepo)).not.toContain("feature-on-master");
      expect(branches(masterRepo)).toContain("master");
    } finally {
      rmSync(masterBare, { force: true, recursive: true });
      rmSync(masterRepo, { force: true, recursive: true });
    }
  });

  // dry-run ではブランチも worktree も削除されない
  test("dry-run does not delete anything", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b dry-run-branch");
    commitFile(repo, "dry.txt", "dry work");
    git(repo, "checkout main");
    git(repo, "merge --squash dry-run-branch");
    git(repo, 'commit -m "squash dry"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "dry-run-wt-dir");
    git(repo, `worktree add ${wtDir} dry-run-branch`);

    const output = run(repo, "--dry-run");

    // ブランチも worktree も残っている
    expect(branches(repo)).toContain("dry-run-branch");
    expect(worktrees(repo).length).toBeGreaterThan(1);
    // 出力にはサマリーが表示される
    expect(output).toContain("Dry run mode");
    expect(output).toContain("→");
    expect(output).toContain("dry-run-wt-dir");
    // worktree にチェックアウト中のブランチは · currently checked out として表示
    expect(output).toContain("·");
    expect(output).toContain("currently checked out");
    expect(output).toContain("Would harvest");

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // ブランチ名がマージ済みブランチのプレフィックスでも誤マッチしない
  test("does not delete worktree whose branch name is a prefix of a merged branch", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // feature-login をマージ済みにする
    git(repo, "checkout -b feature-login");
    commitFile(repo, "login.txt", "login");
    git(repo, "checkout main");
    git(repo, "merge --squash feature-login");
    git(repo, 'commit -m "squash feature-login"');
    git(repo, "push");

    // feature は未マージのまま worktree を作成
    git(repo, "checkout -b feature");
    commitFile(repo, "feature.txt", "feature work");
    git(repo, "checkout main");

    const wtDir = path.join(repo, "..", "wt-feature-dir");
    git(repo, `worktree add ${wtDir} feature`);

    run(repo);

    // feature-login は削除されるが、feature の worktree とブランチは残る
    expect(branches(repo)).not.toContain("feature-login");
    expect(branches(repo)).toContain("feature");
    expect(worktrees(repo).length).toBeGreaterThan(1);

    // cleanup
    git(repo, `worktree remove ${wtDir}`);
  });

  // dry-run でステージ済み変更のある worktree は · uncommitted changes を表示
  test("dry-run shows GROWING for worktrees with staged-only changes", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b drywt-staged");
    commitFile(repo, "staged-base.txt", "base");
    git(repo, "checkout main");
    git(repo, "merge --squash drywt-staged");
    git(repo, 'commit -m "squash staged"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "drywt-staged-dir");
    git(repo, `worktree add ${wtDir} drywt-staged`);
    // worktree でファイルをステージだけして、コミットはしない
    writeFileSync(path.join(wtDir, "staged-only.txt"), "staged\n");
    git(wtDir, "add staged-only.txt");

    const output = run(repo, "--dry-run");

    expect(output).not.toContain(`→`);
    expect(output).toContain("·");
    expect(output).toContain("uncommitted changes");

    // cleanup
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // dry-run でメインワーキングツリーは表示しない
  test("dry-run skips main working tree", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b drywt-main-check");
    commitFile(repo, "drywt.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash drywt-main-check");
    git(repo, 'commit -m "squash drywt"');
    git(repo, "push");

    const output = run(repo, "--dry-run");

    // メインワーキングツリー (repo 自体) は Worktrees セクションに含まれない
    expect(output).not.toContain(`→  ${repo}`);
  });

  // dry-run で未コミット変更のある worktree は · uncommitted changes を表示
  test("dry-run shows GROWING for dirty worktrees", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b drywt-dirty");
    commitFile(repo, "dirty-base.txt", "base");
    git(repo, "checkout main");
    git(repo, "merge --squash drywt-dirty");
    git(repo, 'commit -m "squash dirty"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "drywt-dirty-dir");
    git(repo, `worktree add ${wtDir} drywt-dirty`);
    // worktree に未コミットの変更を追加
    writeFileSync(path.join(wtDir, "uncommitted.txt"), "dirty\n");

    const output = run(repo, "--dry-run");

    // dirty な worktree は · として表示
    expect(output).toContain("·");
    expect(output).toContain("uncommitted changes");
    // worktree にチェックアウト中のブランチも削除できない
    expect(output).toContain("currently checked out");

    // cleanup
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // マージ済みブランチをチェックアウト中に実行 → · currently checked out を表示
  test("shows GROWING for merged branch that is currently checked out", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b checked-out-merged");
    commitFile(repo, "co.txt", "checked out work");
    git(repo, "checkout main");
    git(repo, "merge --squash checked-out-merged");
    git(repo, 'commit -m "squash co"');
    git(repo, "push");

    // マージ済みブランチに戻って実行
    git(repo, "checkout checked-out-merged");
    const output = run(repo);

    // ブランチは削除されず · currently checked out を表示
    expect(branches(repo)).toContain("checked-out-merged");
    expect(output).toContain("·");
    expect(output).toContain("checked-out-merged");
    expect(output).toContain("currently checked out");
    expect(output).not.toContain("✓");
  });

  // 実行時: マージ済み + dirty worktree → · uncommitted changes を表示
  test("shows GROWING for dirty worktree during actual run", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b dirty-wt-run");
    commitFile(repo, "dirty-run.txt", "dirty run work");
    git(repo, "checkout main");
    git(repo, "merge --squash dirty-wt-run");
    git(repo, 'commit -m "squash dirty-run"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "dirty-wt-run-dir");
    git(repo, `worktree add ${wtDir} dirty-wt-run`);
    // worktree に未コミットの変更を追加
    writeFileSync(path.join(wtDir, "uncommitted.txt"), "dirty\n");

    const output = run(repo);

    // worktree もブランチも残る
    expect(worktrees(repo).length).toBeGreaterThan(1);
    expect(branches(repo)).toContain("dirty-wt-run");
    // · uncommitted changes が表示される
    expect(output).toContain("·");
    expect(output).toContain("uncommitted changes");
    expect(output).not.toContain("✓");

    // cleanup
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // 全てのブランチが GROWING の場合 → "Nothing to harvest. All growing." を表示
  test('shows "All growing" when nothing is deleted', () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b only-growing");
    commitFile(repo, "growing.txt", "growing work");
    git(repo, "checkout main");

    const output = run(repo);

    expect(output).toContain("Nothing to harvest. All growing.");
    expect(output).not.toContain("Harvested");
  });

  // exit code 0
  test("exits with 0 on successful cleanup", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b to-clean");
    commitFile(repo, "clean.txt", "clean me");
    git(repo, "checkout main");
    git(repo, "merge --squash to-clean");
    git(repo, 'commit -m "squash clean"');
    git(repo, "push");

    // run() は execSync なので失敗したら throw される
    // 正常に返ることが exit 0 の証明
    expect(() => run(repo)).not.toThrow();
  });
});

describe("--all", () => {
  // マージ済み + 未マージを全部削除する
  test("deletes all branches including unmerged", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // マージ済みブランチ
    git(repo, "checkout -b merged-all");
    commitFile(repo, "merged-all.txt", "merged work");
    git(repo, "checkout main");
    git(repo, "merge --squash merged-all");
    git(repo, 'commit -m "squash merged-all"');
    git(repo, "push");

    // 未マージブランチ
    git(repo, "checkout -b unmerged-all");
    commitFile(repo, "unmerged-all.txt", "unmerged work");
    git(repo, "checkout main");

    const output = run(repo, "--all");

    expect(branches(repo)).not.toContain("merged-all");
    expect(branches(repo)).not.toContain("unmerged-all");
    expect(branches(repo)).toContain("main");
    expect(output).toContain("✓");
    expect(output).toContain("Harvested");
  });

  // デフォルトブランチは残る
  test("preserves default branch", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b to-delete-all");
    commitFile(repo, "del.txt", "del");
    git(repo, "checkout main");

    run(repo, "--all");

    expect(branches(repo)).toContain("main");
    expect(branches(repo)).not.toContain("to-delete-all");
  });

  // メインワーキングツリーは残る
  test("preserves main working tree", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-all-check");
    commitFile(repo, "wt-all.txt", "wt work");
    git(repo, "checkout main");

    const wtDir = path.join(repo, "..", "wt-all-check-dir");
    git(repo, `worktree add ${wtDir} wt-all-check`);

    run(repo, "--all");

    // メインワーキングツリーは残り、linked worktree は削除される
    expect(worktrees(repo)).toHaveLength(1);
    expect(branches(repo)).not.toContain("wt-all-check");
  });

  // 未コミット変更のある worktree も強制削除する
  test("force removes worktrees with uncommitted changes", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-dirty-all");
    commitFile(repo, "wt-dirty-all.txt", "work");
    git(repo, "checkout main");

    const wtDir = path.join(repo, "..", "wt-dirty-all-dir");
    git(repo, `worktree add ${wtDir} wt-dirty-all`);
    writeFileSync(path.join(wtDir, "uncommitted.txt"), "dirty\n");

    const output = run(repo, "--all");

    expect(worktrees(repo)).toHaveLength(1);
    expect(branches(repo)).not.toContain("wt-dirty-all");
    expect(output).toContain("✓");
  });

  // チェックアウト中のブランチはエラー終了する
  test("exits with error when non-default branch is checked out", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b checked-out-all");
    commitFile(repo, "co-all.txt", "work");

    const result = runExpectFail(repo, "--all");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot delete branch");
    expect(result.stderr).toContain("checked-out-all");
    expect(result.stderr).toContain("git checkout main");
  });

  // エラー時に何も削除されない
  test("deletes nothing when checkout error occurs", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // マージ済みブランチを作成
    git(repo, "checkout -b merged-no-delete");
    commitFile(repo, "mnd.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash merged-no-delete");
    git(repo, 'commit -m "squash mnd"');
    git(repo, "push");

    // 未マージブランチに移動して --all を実行
    git(repo, "checkout -b blocking-branch");
    commitFile(repo, "block.txt", "block");

    runExpectFail(repo, "--all");

    // どちらのブランチも残っている
    expect(branches(repo)).toContain("merged-no-delete");
    expect(branches(repo)).toContain("blocking-branch");
  });

  // --dry-run --all で全リソースが → 表示される
  test("dry-run --all shows WILL DELETE for all resources", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // マージ済みブランチ
    git(repo, "checkout -b dry-merged-all");
    commitFile(repo, "dry-m.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash dry-merged-all");
    git(repo, 'commit -m "squash dry-merged"');
    git(repo, "push");

    // 未マージブランチ
    git(repo, "checkout -b dry-unmerged-all");
    commitFile(repo, "dry-u.txt", "work");
    git(repo, "checkout main");

    const output = run(repo, "--dry-run --all");

    expect(output).toContain("Dry run mode");
    expect(output).toContain("→");
    expect(output).toContain("dry-merged-all");
    expect(output).toContain("dry-unmerged-all");
    // ブランチは残っている
    expect(branches(repo)).toContain("dry-merged-all");
    expect(branches(repo)).toContain("dry-unmerged-all");
  });

  // --all --dry-run でも同じ動作（引数順序）
  test("--all --dry-run works regardless of argument order", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b order-test");
    commitFile(repo, "order.txt", "work");
    git(repo, "checkout main");

    const output = run(repo, "--all --dry-run");

    expect(output).toContain("Dry run mode");
    expect(output).toContain("→");
    expect(output).toContain("order-test");
    expect(branches(repo)).toContain("order-test");
  });

  // --dry-run --all でチェックアウト中のブランチも → 表示（エラーにならない）
  test("dry-run --all shows WILL DELETE for checked-out branch without error", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b dry-checked-out");
    commitFile(repo, "dry-co.txt", "work");

    const output = run(repo, "--dry-run --all");

    expect(output).toContain("Dry run mode");
    expect(output).toContain("→");
    expect(output).toContain("dry-checked-out");
    expect(branches(repo)).toContain("dry-checked-out");
  });

  // detached HEAD では全ブランチ削除できる
  test("deletes all branches when in detached HEAD state", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b detached-test");
    commitFile(repo, "detached.txt", "detached work");
    git(repo, "checkout main");

    // detached HEAD にする
    const headSha = git(repo, "rev-parse HEAD").trim();
    git(repo, `checkout ${headSha}`);

    const output = run(repo, "--all");

    expect(branches(repo)).not.toContain("detached-test");
    expect(branches(repo)).toContain("main");
    expect(output).toContain("✓");
  });
});

// NOTE: worktree ディレクトリ名・ブランチ名に "locked" の部分文字列を含めないこと。
// status 文字列 "locked" を toContain で検証するため、パスに紛れると false positive になる。
describe("worktree lock", () => {
  // マージ済み（=本来削除対象）の locked worktree を通常モードで保護し、harvest を中断させない
  test("protects locked merged worktree and continues harvesting (no abort)", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    // マージ済みブランチの worktree を作って lock する（lock しなければ削除される対象）
    git(repo, "checkout -b feat-lk");
    commitFile(repo, "lk.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash feat-lk");
    git(repo, 'commit -m "squash feat-lk"');
    git(repo, "push");
    const wtDir = path.join(repo, "..", "wt-lk-dir");
    git(repo, `worktree add ${wtDir} feat-lk`);
    git(repo, `worktree lock ${wtDir}`);

    // 別途マージ済みブランチ（worktree なし）。中断しなければ削除されるはず
    git(repo, "checkout -b merged-after");
    commitFile(repo, "maf.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash merged-after");
    git(repo, 'commit -m "squash merged-after"');
    git(repo, "push");

    const output = run(repo);

    // locked worktree は保護され残る
    expect(worktrees(repo)).toHaveLength(2);
    expect(branches(repo)).toContain("feat-lk");
    expect(output).toContain("·");
    expect(output).toContain("locked");
    // 中断していない証拠: cleanup_branches まで到達してマージ済みブランチが削除される
    expect(branches(repo)).not.toContain("merged-after");
    expect(output).toContain("Harvested");

    // cleanup
    git(repo, `worktree unlock ${wtDir}`);
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // .claude/worktrees/ 配下（managed path = 通常は --force 削除対象）でも lock が優先される
  test("lock takes precedence over .claude/worktrees managed path", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feat-mgd");
    commitFile(repo, "mgd.txt", "work");
    git(repo, "checkout main");
    mkdirSync(path.join(repo, ".claude", "worktrees"), { recursive: true });
    const wtDir = path.join(repo, ".claude", "worktrees", "mgd");
    git(repo, `worktree add ${wtDir} feat-mgd`);
    git(repo, `worktree lock ${wtDir}`);

    const output = run(repo);

    expect(worktrees(repo)).toHaveLength(2);
    expect(output).toContain("locked");

    git(repo, `worktree unlock ${wtDir}`);
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // dry-run でも lock を保護として表示し、削除しない
  test("shows locked status in dry-run without removing", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feat-dry");
    commitFile(repo, "d.txt", "work");
    git(repo, "checkout main");
    const wtDir = path.join(repo, "..", "wt-dry-dir");
    git(repo, `worktree add ${wtDir} feat-dry`);
    git(repo, `worktree lock ${wtDir}`);

    const output = run(repo, "-n");

    expect(output).toContain("·");
    expect(output).toContain("locked");
    expect(worktrees(repo)).toHaveLength(2);

    git(repo, `worktree unlock ${wtDir}`);
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // --all は lock を貫通して削除し、(was locked) の痕跡を残す
  test("--all force-removes locked worktree and shows (was locked)", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feat-all");
    commitFile(repo, "a.txt", "work");
    git(repo, "checkout main");
    const wtDir = path.join(repo, "..", "wt-all-dir");
    git(repo, `worktree add ${wtDir} feat-all`);
    git(repo, `worktree lock --reason "keep me" ${wtDir}`);

    const output = run(repo, "--all");

    expect(worktrees(repo)).toHaveLength(1);
    expect(branches(repo)).not.toContain("feat-all");
    expect(output).toContain("✓");
    expect(output).toContain("was locked");
  });

  // --all --dry-run は lock を would-remove 表示するが削除しない
  test("--all --dry-run shows would-remove for locked worktree without removing", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feat-adry");
    commitFile(repo, "ad.txt", "work");
    git(repo, "checkout main");
    const wtDir = path.join(repo, "..", "wt-adry-dir");
    git(repo, `worktree add ${wtDir} feat-adry`);
    git(repo, `worktree lock ${wtDir}`);

    const output = run(repo, "--dry-run --all");

    expect(output).toContain("→");
    expect(output).toContain("was locked");
    expect(worktrees(repo)).toHaveLength(2);

    git(repo, `worktree unlock ${wtDir}`);
    git(repo, `worktree remove --force ${wtDir}`);
  });

  // --reason 付きで lock した worktree も通常モードで検出・保護する
  test("detects lock created with --reason in normal mode", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b feat-rsn");
    commitFile(repo, "r.txt", "work");
    git(repo, "checkout main");
    const wtDir = path.join(repo, "..", "wt-rsn-dir");
    git(repo, `worktree add ${wtDir} feat-rsn`);
    git(repo, `worktree lock --reason "WIP do not touch" ${wtDir}`);

    const output = run(repo);

    expect(output).toContain("locked");
    expect(worktrees(repo)).toHaveLength(2);

    git(repo, `worktree unlock ${wtDir}`);
    git(repo, `worktree remove --force ${wtDir}`);
  });
});

describe("claude session protection", () => {
  // pid ファイルが残っていても pid が死んでいれば保護しない (stale 扱い)
  test("does not protect when claude session pid is dead (stale file)", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-stale-claude");
    commitFile(repo, "stale.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash wt-stale-claude");
    git(repo, 'commit -m "squash stale"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "wt-stale-claude-dir");
    git(repo, `worktree add ${wtDir} wt-stale-claude`);

    // 短命プロセスを spawn して即終了させ、その pid を再利用する
    // pid 1 は init/launchd でほぼ確実に生きているため使えない。
    // 高い未使用 pid を狙う方が確実だが、portable に dead pid を作る方法として
    // spawnSync で完了済みプロセスの pid を使う
    const dead = spawnSync("true");
    const deadPid = dead.pid;

    const sessionsDir = mkdtempSync(path.join(tmpdir(), "gh-claude-sess-"));
    writeFileSync(
      path.join(sessionsDir, `${String(deadPid)}.json`),
      JSON.stringify({ cwd: wtDir, pid: deadPid, sessionId: "stale", status: "idle" }),
    );

    try {
      const output = execSync(`bash ${SCRIPT}`, {
        cwd: repo,
        encoding: "utf8",
        env: { ...TEST_ENV, GIT_HARVEST_CLAUDE_SESSIONS_DIR: sessionsDir },
      });

      // pid が死んでいるので保護されず、merged worktree は削除される
      expect(branches(repo)).not.toContain("wt-stale-claude");
      expect(output).toContain("✓");
      expect(output).not.toContain("session running");
    } finally {
      rmSync(sessionsDir, { force: true, recursive: true });

      try {
        git(repo, `worktree remove --force ${wtDir}`);
      } catch {
        // ignore
      }
    }
  });

  // 走行中の claude プロセス (~/.claude/sessions/<pid>.json で cwd 一致 & pid alive) があれば、
  // マージ済み worktree でも保護する
  test("preserves merged worktree when a claude session is running in it", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-claude-running");
    commitFile(repo, "claude-running.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash wt-claude-running");
    git(repo, 'commit -m "squash claude-running"');
    git(repo, "push");

    const wtDir = path.join(repo, "..", "wt-claude-running-dir");
    git(repo, `worktree add ${wtDir} wt-claude-running`);

    // 生きた pid を持つプロセスを spawn (sleep 60s)
    const { pid: livePid, proc: sleepProc } = spawnLiveSession();

    // 走行中セッションを模した JSON を書き込む
    const sessionsDir = mkdtempSync(path.join(tmpdir(), "gh-claude-sess-"));
    writeFileSync(
      path.join(sessionsDir, `${String(livePid)}.json`),
      JSON.stringify({
        cwd: wtDir,
        pid: livePid,
        sessionId: "test-session",
        status: "idle",
        updatedAt: Date.now(),
      }),
    );

    try {
      const output = execSync(`bash ${SCRIPT}`, {
        cwd: repo,
        encoding: "utf8",
        env: { ...TEST_ENV, GIT_HARVEST_CLAUDE_SESSIONS_DIR: sessionsDir },
      });

      expect(branches(repo)).toContain("wt-claude-running");
      expect(worktrees(repo).length).toBeGreaterThan(1);
      expect(output).toContain("·");
      expect(output).toContain("session running");
      expect(output).not.toContain("✓");
    } finally {
      sleepProc.kill("SIGKILL");
      rmSync(sessionsDir, { force: true, recursive: true });

      try {
        git(repo, `worktree remove --force ${wtDir}`);
      } catch {
        // ignore
      }
    }
  });

  // --all は走行中の Claude session 保護も bypass して全削除する
  test("--all bypasses running claude session protection", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-claude-all");
    commitFile(repo, "all.txt", "work");
    git(repo, "checkout main");

    const wtDir = path.join(repo, "..", "wt-claude-all-dir");
    git(repo, `worktree add ${wtDir} wt-claude-all`);

    // 走行中 session を仕込んでおく
    const { pid: livePid, proc: sleepProc } = spawnLiveSession();
    const sessionsDir = mkdtempSync(path.join(tmpdir(), "gh-claude-sess-"));
    writeFileSync(
      path.join(sessionsDir, `${String(livePid)}.json`),
      JSON.stringify({ cwd: wtDir, pid: livePid, status: "busy" }),
    );

    try {
      const output = execSync(`bash ${SCRIPT} --all`, {
        cwd: repo,
        encoding: "utf8",
        env: { ...TEST_ENV, GIT_HARVEST_CLAUDE_SESSIONS_DIR: sessionsDir },
      });

      // --all は claude 保護を無視して削除する
      expect(branches(repo)).not.toContain("wt-claude-all");
      expect(worktrees(repo)).toHaveLength(1);
      expect(output).toContain("✓");
      expect(output).not.toContain("session running");
    } finally {
      sleepProc.kill("SIGKILL");
      rmSync(sessionsDir, { force: true, recursive: true });
    }
  });

  // 未マージ worktree でも走行中セッションがあれば、表示は not merged ではなく session running が勝つ
  // (層 ① は merged 判定の外で動くため。設計意図の固定テスト)
  test("shows session-running label over not-merged for unmerged worktree with running claude", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-unmerged-running");
    commitFile(repo, "unm-run.txt", "work");
    git(repo, "checkout main");
    // merge せず未マージのまま

    const wtDir = path.join(repo, "..", "wt-unmerged-running-dir");
    git(repo, `worktree add ${wtDir} wt-unmerged-running`);

    const { pid: livePid, proc: sleepProc } = spawnLiveSession();

    const sessionsDir = mkdtempSync(path.join(tmpdir(), "gh-claude-sess-"));
    writeFileSync(
      path.join(sessionsDir, `${String(livePid)}.json`),
      JSON.stringify({ cwd: wtDir, pid: livePid, status: "idle" }),
    );

    try {
      const output = execSync(`bash ${SCRIPT}`, {
        cwd: repo,
        encoding: "utf8",
        env: { ...TEST_ENV, GIT_HARVEST_CLAUDE_SESSIONS_DIR: sessionsDir },
      });

      // worktree は残る (どちらの理由でも残る) かつ表示は走行中が勝つ
      expect(branches(repo)).toContain("wt-unmerged-running");
      expect(output).toContain("wt-unmerged-running-dir");
      expect(output).toContain("session running");
      // worktree 行が 'session running' で表示され、'not merged' で表示されないこと
      expect(output).not.toMatch(/wt-unmerged-running-dir[^\n]*not merged/);
    } finally {
      sleepProc.kill("SIGKILL");
      rmSync(sessionsDir, { force: true, recursive: true });

      try {
        git(repo, `worktree remove --force ${wtDir}`);
      } catch {
        // ignore
      }
    }
  });

  // .claude/worktrees/ 配下で active session が無い worktree は、未マージでも削除される
  // (commits は branch ref に残り、cleanup_branches で「not merged」保護されるため失われない)
  test("deletes claude-managed worktree when branch is unmerged and no active session", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-cm-unmerged");
    commitFile(repo, "cm.txt", "work");
    git(repo, "checkout main");
    // 未マージのまま

    const wtDir = path.join(repo, ".claude", "worktrees", "wt-cm-unmerged");
    git(repo, `worktree add ${wtDir} wt-cm-unmerged`);

    const output = execSync(`bash ${SCRIPT}`, {
      cwd: repo,
      encoding: "utf8",
      env: TEST_ENV,
    });

    expect(worktrees(repo)).toHaveLength(1);
    // worktree が削除されたことを path 含みで確認
    expect(output).toMatch(/✓\s+(?:\S[^\n]*)?wt-cm-unmerged/);
    // 未マージ branch は safety net として残る
    expect(branches(repo)).toContain("wt-cm-unmerged");
  });

  // .claude/worktrees/ 配下の worktree は uncommitted changes があっても --force で削除される (case C)
  test("deletes claude-managed worktree even with uncommitted changes", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-cm-dirty");
    commitFile(repo, "cm.txt", "work");
    git(repo, "checkout main");
    git(repo, "merge --squash wt-cm-dirty");
    git(repo, 'commit -m "squash"');
    git(repo, "push");

    const wtDir = path.join(repo, ".claude", "worktrees", "wt-cm-dirty");
    git(repo, `worktree add ${wtDir} wt-cm-dirty`);
    // uncommitted changes を作る
    writeFileSync(path.join(wtDir, "cm.txt"), "dirty content");

    const output = execSync(`bash ${SCRIPT}`, {
      cwd: repo,
      encoding: "utf8",
      env: TEST_ENV,
    });

    expect(worktrees(repo)).toHaveLength(1);
    expect(output).toContain("✓");
    expect(output).not.toContain("uncommitted changes");
  });

  // .claude/worktrees/ 配下の worktree は「独自 commits なし」状態でも削除される
  test("deletes claude-managed worktree when branch has no unique commits", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-cm-empty");
    git(repo, "checkout main");

    const wtDir = path.join(repo, ".claude", "worktrees", "wt-cm-empty");
    git(repo, `worktree add ${wtDir} wt-cm-empty`);

    const output = execSync(`bash ${SCRIPT}`, {
      cwd: repo,
      encoding: "utf8",
      env: TEST_ENV,
    });

    expect(worktrees(repo)).toHaveLength(1);
    expect(output).toContain("✓");
    expect(output).not.toMatch(/wt-cm-empty[^\n]*no unique commits/);
  });

  // --dry-run では path-regime 削除対象を `→` で示すだけで worktree dir は残す
  test("dry-run shows claude-managed worktree as will-remove without deleting it", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-cm-dry");
    commitFile(repo, "cm.txt", "work");
    git(repo, "checkout main");
    // 未マージのまま (path-regime 経路に入ることを保証)

    const wtDir = path.join(repo, ".claude", "worktrees", "wt-cm-dry");
    git(repo, `worktree add ${wtDir} wt-cm-dry`);

    try {
      const output = execSync(`bash ${SCRIPT} --dry-run`, {
        cwd: repo,
        encoding: "utf8",
        env: TEST_ENV,
      });

      // → で will-remove 表示される
      expect(output).toMatch(/→\s+(?:\S[^\n]*)?wt-cm-dry/);
      // dry-run なので実削除は走らない
      expect(worktrees(repo).length).toBeGreaterThan(1);
      expect(branches(repo)).toContain("wt-cm-dry");
    } finally {
      try {
        git(repo, `worktree remove --force ${wtDir}`);
      } catch {
        // ignore
      }
    }
  });

  // .claude/worktrees/ 配下でも、走行中の Claude session があれば保護する
  test("preserves claude-managed worktree when claude session is running", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-cm-running");
    commitFile(repo, "cm.txt", "work");
    git(repo, "checkout main");

    const wtDir = path.join(repo, ".claude", "worktrees", "wt-cm-running");
    git(repo, `worktree add ${wtDir} wt-cm-running`);

    // 走行中 session を仕込む
    const { pid: livePid, proc: sleepProc } = spawnLiveSession();
    const sessionsDir = mkdtempSync(path.join(tmpdir(), "gh-claude-sess-"));
    writeFileSync(
      path.join(sessionsDir, `${String(livePid)}.json`),
      JSON.stringify({ cwd: wtDir, pid: livePid, status: "busy" }),
    );

    try {
      const output = execSync(`bash ${SCRIPT}`, {
        cwd: repo,
        encoding: "utf8",
        env: { ...TEST_ENV, GIT_HARVEST_CLAUDE_SESSIONS_DIR: sessionsDir },
      });

      expect(worktrees(repo).length).toBeGreaterThan(1);
      expect(output).toContain("session running");
      expect(output).not.toMatch(/wt-cm-running[^\n]*✓/);
    } finally {
      sleepProc.kill("SIGKILL");
      rmSync(sessionsDir, { force: true, recursive: true });

      try {
        git(repo, `worktree remove --force ${wtDir}`);
      } catch {
        // ignore
      }
    }
  });

  // .claude/worktrees/ 配下じゃない worktree は未マージなら従来通り保護される (path-regime 適用外)
  test("preserves non-claude-managed worktree when branch is unmerged", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    git(repo, "checkout -b wt-ext-unmerged");
    commitFile(repo, "ext.txt", "work");
    git(repo, "checkout main");
    // 未マージのまま

    const wtDir = path.join(repo, "..", "wt-ext-unmerged-dir");
    git(repo, `worktree add ${wtDir} wt-ext-unmerged`);

    try {
      const output = execSync(`bash ${SCRIPT}`, {
        cwd: repo,
        encoding: "utf8",
        env: TEST_ENV,
      });

      expect(branches(repo)).toContain("wt-ext-unmerged");
      expect(output).toContain("not merged");
      expect(worktrees(repo).length).toBeGreaterThan(1);
    } finally {
      try {
        git(repo, `worktree remove --force ${wtDir}`);
      } catch {
        // ignore
      }
    }
  });
});

describe("unknown option", () => {
  // 不明なオプションでエラー終了する
  test("exits with error for unknown options", () => {
    using ctx = setupRepo();
    const { repo } = ctx;

    const result = runExpectFail(repo, "--invalid");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unknown option: --invalid");
  });
});
