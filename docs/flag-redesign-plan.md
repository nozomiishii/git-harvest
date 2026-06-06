# git-harvest TS 移行 + フラグ簡素化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bash の `lib/git-harvest` を TypeScript に置き換え、`docs/flag-redesign.md` の scope-as-value フラグ設計を実装し、npm/npx 配布で 0.3.0 をリリースする。

**Architecture:** 単一責務の小モジュール（types / git / merge-detect / agent / worktree / branch / flags / format / brand / cli）に分割。検出（merge-detect・agent path/session・base 解決）→ 判定（worktree/branch decision + flags）→ 整形出力（format）を cli が束ねる。git 実行は `node:child_process` の execFile wrapper 経由でランタイム依存ゼロ。tsdown で単一 ESM `dist/git-harvest` に固める。

**Tech Stack:** TypeScript 6 / Node ≥24（ESM）/ tsdown / vitest / pnpm。すべて main 7b8185d に staged 済み。

---

## 前提・全体方針（実装前に必読）

- 土台ブランチ: `main` 7b8185d。新規 feature ブランチを切って作業する。PR #180 / `feat/ts-migration` のコードは **無視**。
- 仕様の正本: `docs/flag-redesign.md`。挙動の細部（merge 検出 4 段・session 検出・invariant）は現行 bash `lib/git-harvest` を spec として踏襲。
- バージョン: 0.2.3 → **0.3.0**（v1 見送り。0.x は破壊的変更も minor）。`feat!` は使わず `feat:`。
- scope は初期実装で `worktree` / `claude-worktree` / `branch` の 3 つ。`codex-worktree` は path 規約確定後に「SCOPES 1 行 + matcher 1 個 + session 検出 1 個」で非破壊追加（本計画では実装しない）。
- CLI 変更チェックリスト（`CLAUDE.md`）: help テキスト / `README.md` / `README.ja.md` を最終タスクで同時更新。
- テストスタイル（`CLAUDE.md`）: タイトル英語・直上に日本語コメント・ソースと同ディレクトリ・1 テスト 1 振る舞い・Lifecycle Hooks 不使用（`using` + ヘルパー）・tautology 回避。
- コミット: body は ASCII（英語）・各行 ≤100・type は feat/fix/chore。各タスク末尾でコミット。

## ファイル構成

```
lib/
  types.ts          # Stage / Scope / SAFETY / SCOPES / Flags / Classification / 結果型 + 純粋ヘルパー
  git.ts            # execFile wrapper: git() / gitText() / gitExitOk()
  merge-detect.ts   # classifyBranch(): untouched | merged | other（4 段フォールバック）
  agent.ts          # isClaudeWorktree() / scopeOfPath() / hasRunningClaudeSession()
  flags.ts          # SCOPES / parseArgs() / defaultFlags() / yolo 展開 / helpText()
  worktree.ts       # cleanupWorktrees(): worktreeStage / decideWorktree / invariant
  branch.ts         # cleanupBranches(): decideBranch / invariant
  format.ts         # 色・bold・dim・status ラベル行
  brand.ts          # logo()
  cli.ts            # main(argv) / resolveBase() / orchestration / エントリ
  test-helpers.ts   # makeRepo()（self-contained）
bin/git-harvest     # #!/usr/bin/env node ; import('../dist/git-harvest')
tsdown.config.ts    # entry lib/cli.ts → dist/git-harvest（shebang 付与）
```

各 `lib/<name>.ts` の隣に `lib/<name>.test.ts`。

---

## Milestone 1: 土台（型・git wrapper・ビルド配線）

### Task 1: 型と純粋ヘルパー（types.ts）

- [ ] **失敗テスト** `lib/types.test.ts`

```ts
import { expect, test } from "vitest";
import { atOrSafer, SAFETY } from "./types";
// merged は files-changed 閾値以降（安全側）として削除対象
test("atOrSafer treats merged as deletable when threshold is files-changed", () => {
  expect(atOrSafer("merged", "files-changed")).toBe(true);
});
// committed は default 閾値 merged では消えない
test("atOrSafer keeps committed when threshold is merged", () => {
  expect(atOrSafer("committed", "merged")).toBe(false);
});
// SAFETY は危険 → 安全の順
test("SAFETY orders stages from risky to safe", () => {
  expect([...SAFETY]).toEqual(["files-changed", "committed", "merged"]);
});
```

- [ ] **失敗確認** `pnpm vitest run lib/types.test.ts`
- [ ] **実装** `lib/types.ts`

```ts
export type Stage = "files-changed" | "committed" | "merged";
export const SAFETY: readonly Stage[] = ["files-changed", "committed", "merged"];
export const SCOPES = ["worktree", "claude-worktree", "branch"] as const;
export type Scope = (typeof SCOPES)[number];
export const WORKTREE_SCOPES = ["worktree", "claude-worktree"] as const;

export type Flags = {
  thresholds: Record<Scope, Stage>;
  untouched: boolean;
  detached: boolean;
  dryRun: boolean;
};
// untouched=独自コミット無し / merged=base 取り込み済み / other=未取り込み
export type Classification = "untouched" | "merged" | "other";
export type ActionResult =
  | { action: "removed"; name: string }
  | { action: "would-remove"; name: string }
  | { action: "kept"; name: string; reason: string }
  | { action: "failed"; name: string; error: string };
export type CleanupResult = { results: ActionResult[]; failures: number; survivingPaths: string[] };
// stage が threshold 以降（安全側）なら削除対象
export function atOrSafer(stage: Stage, threshold: Stage): boolean {
  return SAFETY.indexOf(stage) >= SAFETY.indexOf(threshold);
}
```

- [ ] **成功確認** PASS(3) → commit `feat: add stage/scope types and atOrSafer helper`

### Task 2: git wrapper（git.ts）+ test helper

- [ ] **test-helpers** `lib/test-helpers.ts`

```ts
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const exec = promisify(execFile);
export type Repo = {
  dir: string;
  git: (...args: string[]) => Promise<string>;
  commit: (message: string) => Promise<void>;
  [Symbol.asyncDispose]: () => Promise<void>;
};
// `await using repo = await makeRepo()` でスコープ離脱時に自動削除
export async function makeRepo(): Promise<Repo> {
  const dir = mkdtempSync(join(tmpdir(), "git-harvest-test-"));
  const git = async (...args: string[]): Promise<string> => (await exec("git", args, { cwd: dir })).stdout.trim();
  await git("init", "-b", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  const commit = async (message: string): Promise<void> => { await git("commit", "--allow-empty", "-m", message); };
  await commit("init");
  await git("remote", "add", "origin", dir);
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return { dir, git, commit, [Symbol.asyncDispose]: async () => rmSync(dir, { recursive: true, force: true }) };
}
```

- [ ] **失敗テスト** `lib/git.test.ts`

```ts
import { expect, test } from "vitest";
import { gitExitOk, gitText } from "./git";
import { makeRepo } from "./test-helpers";
// gitText は trim した stdout
test("gitText returns trimmed stdout", async () => {
  await using repo = await makeRepo();
  expect(await gitText(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo.dir })).toBe("main");
});
// gitExitOk は失敗で false（throw しない）
test("gitExitOk reports false on a failing command instead of throwing", async () => {
  await using repo = await makeRepo();
  expect(await gitExitOk(["rev-parse", "does-not-exist"], { cwd: repo.dir })).toBe(false);
});
```

- [ ] **実装** `lib/git.ts`

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
type Opts = { cwd?: string };
export async function git(args: string[], opts: Opts = {}): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await exec("git", args, { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 });
    return { stdout, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; code?: number };
    return { stdout: e.stdout ?? "", code: typeof e.code === "number" ? e.code : 1 };
  }
}
export async function gitText(args: string[], opts: Opts = {}): Promise<string> {
  const { stdout, code } = await git(args, opts);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited with ${code}`);
  return stdout.trim();
}
export async function gitExitOk(args: string[], opts: Opts = {}): Promise<boolean> {
  return (await git(args, opts)).code === 0;
}
```

- [ ] **成功確認** PASS(2) → commit `feat: add git execFile wrapper and test repo helper`

### Task 3: ビルド配線（tsdown / bin / package.json）

- [ ] **暫定 cli.ts**

```ts
export async function main(argv: string[]): Promise<void> {
  if (argv.includes("-v") || argv.includes("--version")) { process.stdout.write("git-harvest v0.3.0\n"); return; }
  process.stdout.write("git-harvest\n");
}
await main(process.argv.slice(2));
```

- [ ] **tsdown.config.ts**

```ts
import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["lib/cli.ts"],
  format: ["esm"],
  outDir: "dist",
  outExtensions: () => ({ js: "" }),
  outputOptions: { entryFileNames: "git-harvest", banner: "#!/usr/bin/env node" },
});
```

- [ ] **bin/git-harvest**

```sh
#!/usr/bin/env node
import("../dist/git-harvest");
```

- [ ] **package.json**: `"version": "0.3.0"` / `"bin": { "git-harvest": "./bin/git-harvest" }` / `"files": ["dist/git-harvest", "bin/git-harvest", "README.md", "README.ja.md", "LICENSE"]` / `"build": "tsdown"` / `"dev": "tsx lib/cli.ts --dry-run"`。`pnpm add -D tsx`。
- [ ] **smoke** `pnpm build && node bin/git-harvest --version` → `git-harvest v0.3.0`
- [ ] commit `feat: wire tsdown build, node bin, and npm distribution`

---

## Milestone 2: 検出

### Task 4: branch 分類（merge-detect.ts）

bash `main()` の 4 段フォールバック移植。

- [ ] **失敗テスト** `lib/merge-detect.test.ts`

```ts
import { expect, test } from "vitest";
import { classifyBranch } from "./merge-detect";
import { makeRepo } from "./test-helpers";
// ancestor として入っていれば merged
test("classifyBranch returns merged for a branch merged into base", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "feature");
  await repo.commit("work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "feature", "-m", "merge feature");
  expect(await classifyBranch("feature", "main", { cwd: repo.dir })).toBe("merged");
});
// 独自コミット無しは untouched
test("classifyBranch returns untouched for a branch with no unique commits", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "fresh");
  expect(await classifyBranch("fresh", "main", { cwd: repo.dir })).toBe("untouched");
});
// 未取り込みの独自コミットは other
test("classifyBranch returns other for an unmerged branch with unique commits", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "wip");
  await repo.commit("unmerged work");
  expect(await classifyBranch("wip", "main", { cwd: repo.dir })).toBe("other");
});
```

- [ ] **実装** `lib/merge-detect.ts`

```ts
import type { Classification } from "./types";
import { git, gitExitOk, gitText } from "./git";
type Opts = { cwd?: string };
export async function classifyBranch(branch: string, base: string, opts: Opts = {}): Promise<Classification> {
  const head = await gitText(["rev-parse", branch], opts);
  const firstParent = (await git(["rev-list", "--first-parent", base], opts)).stdout;
  if (firstParent.split("\n").includes(head)) return "untouched";
  if (await gitExitOk(["merge-base", "--is-ancestor", branch, base], opts)) return "merged";
  const mergeBase = (await git(["merge-base", base, branch], opts)).stdout.trim();
  if (mergeBase) {
    const squash = (await git(["commit-tree", `${branch}^{tree}`, "-p", mergeBase, "-m", "_"], opts)).stdout.trim();
    if (squash) {
      const cherry = (await git(["cherry", base, squash], opts)).stdout;
      const added = cherry.split("\n").filter((l) => l.startsWith("+"));
      if (cherry.trim() && added.length === 0) return "merged";
    }
  }
  const unique = (await git(["log", "--cherry-pick", "--right-only", "--no-merges", "--oneline", `${base}...${branch}`], opts)).stdout;
  return unique.trim() ? "other" : "merged";
}
```

- [ ] **成功確認** PASS(3) → commit `feat: port 4-stage branch classification to merge-detect`

### Task 5: agent path / session（agent.ts）

- [ ] **失敗テスト** `lib/agent.test.ts`

```ts
import { expect, test } from "vitest";
import { isClaudeWorktree, scopeOfPath } from "./agent";
test("scopeOfPath classifies a .claude/worktrees path as claude-worktree", () => {
  expect(scopeOfPath("/repo/.claude/worktrees/foo")).toBe("claude-worktree");
});
test("scopeOfPath classifies a normal path as worktree", () => {
  expect(scopeOfPath("/repo/feature-wt")).toBe("worktree");
});
test("isClaudeWorktree requires at least one char after .claude/worktrees/", () => {
  expect(isClaudeWorktree("/repo/.claude/worktrees")).toBe(false);
  expect(isClaudeWorktree("/repo/.claude/worktrees/x")).toBe(true);
});
```

- [ ] **実装** `lib/agent.ts`

```ts
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function isClaudeWorktree(path: string): boolean {
  return /\/\.claude\/worktrees\/.+/.test(path);
}
export function scopeOfPath(path: string): "worktree" | "claude-worktree" {
  return isClaudeWorktree(path) ? "claude-worktree" : "worktree";
}
function sessionsDir(): string {
  return process.env["GIT_HARVEST_CLAUDE_SESSIONS_DIR"] ?? join(homedir(), ".claude", "sessions");
}
function canonical(path: string): string { try { return realpathSync(path); } catch { return path; } }
export function hasRunningClaudeSession(worktree: string): boolean {
  const dir = sessionsDir();
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return false; }
  const target = canonical(worktree);
  for (const file of files) {
    let raw: string;
    try { raw = readFileSync(join(dir, file), "utf8"); } catch { continue; }
    const cwd = /"cwd"\s*:\s*"([^"]*)"/.exec(raw)?.[1];
    if (!cwd || canonical(cwd) !== target) continue;
    const pid = Number(/"pid"\s*:\s*(\d+)/.exec(raw)?.[1]);
    if (!pid) continue;
    try { process.kill(pid, 0); return true; } catch { continue; }
  }
  return false;
}
```

- [ ] **成功確認** PASS(3) → commit `feat: port claude worktree path and session detection`

---

## Milestone 3: 判定

### Task 6: フラグパース（flags.ts）

- [ ] **失敗テスト** `lib/flags.test.ts`（主要 11 件）

```ts
import { expect, test } from "vitest";
import { defaultFlags, parseArgs } from "./flags";
test("defaultFlags keeps every scope at merged and toggles off", () => {
  const f = defaultFlags();
  expect(f.thresholds).toEqual({ worktree: "merged", "claude-worktree": "merged", branch: "merged" });
  expect(f.untouched).toBe(false);
  expect(f.detached).toBe(false);
});
test("--committed=claude-worktree lowers only the claude scope", () => {
  const p = parseArgs(["--committed=claude-worktree"]);
  if (p.mode !== "run") throw new Error("run");
  expect(p.flags.thresholds["claude-worktree"]).toBe("committed");
  expect(p.flags.thresholds.worktree).toBe("merged");
});
test("bare --committed lowers all scopes", () => {
  const p = parseArgs(["--committed"]);
  if (p.mode !== "run") throw new Error("run");
  expect(p.flags.thresholds).toEqual({ worktree: "committed", "claude-worktree": "committed", branch: "committed" });
});
test("bare --files-changed affects worktree scopes but not branch", () => {
  const p = parseArgs(["--files-changed"]);
  if (p.mode !== "run") throw new Error("run");
  expect(p.flags.thresholds.worktree).toBe("files-changed");
  expect(p.flags.thresholds.branch).toBe("merged");
});
test("--files-changed=branch is rejected", () => { expect(() => parseArgs(["--files-changed=branch"])).toThrow(); });
test("comma-separated scopes apply to each listed scope", () => {
  const p = parseArgs(["--files-changed=worktree,claude-worktree"]);
  if (p.mode !== "run") throw new Error("run");
  expect(p.flags.thresholds["claude-worktree"]).toBe("files-changed");
});
test("--untouched and --detached set the off-ladder toggles", () => {
  const p = parseArgs(["--untouched", "--detached"]);
  if (p.mode !== "run") throw new Error("run");
  expect(p.flags.untouched).toBe(true);
  expect(p.flags.detached).toBe(true);
});
test("--yolo expands to the union of all deletion flags", () => {
  const y = parseArgs(["--yolo"]);
  const m = parseArgs(["--files-changed", "--committed", "--untouched", "--detached"]);
  if (y.mode !== "run" || m.mode !== "run") throw new Error("run");
  expect(y.flags.thresholds).toEqual(m.flags.thresholds);
  expect(y.flags.untouched).toBe(m.flags.untouched);
  expect(y.flags.detached).toBe(m.flags.detached);
});
test("an unknown flag throws", () => { expect(() => parseArgs(["--nope"])).toThrow(); });
test("--help short-circuits to help mode", () => { expect(parseArgs(["--help"]).mode).toBe("help"); });
```

- [ ] **実装** `lib/flags.ts`

```ts
import type { Flags, Scope, Stage } from "./types";
import { SAFETY, SCOPES, WORKTREE_SCOPES } from "./types";
export type Parsed =
  | { mode: "run"; flags: Flags }
  | { mode: "help" }
  | { mode: "version" }
  | { mode: "logo" };
export class UsageError extends Error {}
const STAGE_SCOPES: Record<"committed" | "files-changed", readonly Scope[]> = { committed: SCOPES, "files-changed": WORKTREE_SCOPES };
export function defaultFlags(): Flags {
  return { thresholds: { worktree: "merged", "claude-worktree": "merged", branch: "merged" }, untouched: false, detached: false, dryRun: false };
}
function lower(current: Stage, candidate: Stage): Stage {
  return SAFETY.indexOf(candidate) < SAFETY.indexOf(current) ? candidate : current;
}
function applyStage(flags: Flags, stage: "committed" | "files-changed", value: string | undefined): void {
  const allowed = STAGE_SCOPES[stage];
  const targets = value ? value.split(",") : [...allowed];
  for (const scope of targets) {
    if (!allowed.includes(scope as Scope)) throw new UsageError(`invalid scope for --${stage}: ${scope}`);
    flags.thresholds[scope as Scope] = lower(flags.thresholds[scope as Scope], stage);
  }
}
function applyToken(flags: Flags, arg: string): boolean {
  if (arg === "--untouched") { flags.untouched = true; return true; }
  if (arg === "--detached") { flags.detached = true; return true; }
  const [token, value] = arg.split("=", 2) as [string, string | undefined];
  if (token === "--committed" || token === "--files-changed") {
    applyStage(flags, token === "--committed" ? "committed" : "files-changed", value);
    return true;
  }
  return false;
}
const YOLO_TOKENS = ["--files-changed", "--committed", "--untouched", "--detached"];
export function parseArgs(argv: string[]): Parsed {
  for (const arg of argv) {
    if (arg === "logo") return { mode: "logo" };
    if (arg === "-h" || arg === "--help") return { mode: "help" };
    if (arg === "-v" || arg === "--version") return { mode: "version" };
  }
  const flags = defaultFlags();
  if (argv.includes("--yolo")) for (const t of YOLO_TOKENS) applyToken(flags, t);
  for (const arg of argv) {
    if (arg === "--yolo") continue;
    if (arg === "--dry-run" || arg === "-n") { flags.dryRun = true; continue; }
    if (applyToken(flags, arg)) continue;
    throw new UsageError(`unknown option: ${arg}`);
  }
  return { mode: "run", flags };
}
```

- [ ] **成功確認** PASS(11) → commit `feat: add scope-as-value flag parsing with yolo preset`

### Task 7: worktree 判定（worktree.ts 判定コア）

- [ ] **失敗テスト** `lib/worktree.test.ts`

```ts
import { expect, test } from "vitest";
import { defaultFlags } from "./flags";
import { decideWorktree, type WorktreeInfo } from "./worktree";
function wt(over: Partial<WorktreeInfo>): WorktreeInfo {
  return { path: "/repo/.claude/worktrees/x", isInvariant: false, hasBranch: true, isUntouched: false, hasUncommittedChanges: false, isMerged: false, ...over };
}
test("decideWorktree keeps an invariant worktree even under yolo", () => {
  const yolo = { thresholds: { worktree: "files-changed", "claude-worktree": "files-changed", branch: "committed" }, untouched: true, detached: true, dryRun: false } as const;
  expect(decideWorktree(wt({ isInvariant: true }), yolo).remove).toBe(false);
});
test("decideWorktree removes a merged worktree by default", () => {
  expect(decideWorktree(wt({ isMerged: true }), defaultFlags()).remove).toBe(true);
});
test("decideWorktree keeps a committed worktree by default", () => {
  expect(decideWorktree(wt({ isMerged: false }), defaultFlags()).remove).toBe(false);
});
test("decideWorktree removes a committed claude worktree under --committed=claude-worktree", () => {
  const flags = { ...defaultFlags(), thresholds: { ...defaultFlags().thresholds, "claude-worktree": "committed" as const } };
  expect(decideWorktree(wt({ isMerged: false }), flags).remove).toBe(true);
});
test("decideWorktree keeps untouched by default and removes it with the untouched toggle", () => {
  expect(decideWorktree(wt({ isUntouched: true }), defaultFlags()).remove).toBe(false);
  expect(decideWorktree(wt({ isUntouched: true }), { ...defaultFlags(), untouched: true }).remove).toBe(true);
});
test("decideWorktree keeps detached by default and removes it with the detached toggle", () => {
  expect(decideWorktree(wt({ hasBranch: false }), defaultFlags()).remove).toBe(false);
  expect(decideWorktree(wt({ hasBranch: false }), { ...defaultFlags(), detached: true }).remove).toBe(true);
});
test("decideWorktree treats uncommitted changes as files-changed and keeps them by default", () => {
  expect(decideWorktree(wt({ isMerged: true, hasUncommittedChanges: true }), defaultFlags()).remove).toBe(false);
});
```

- [ ] **実装（判定コア）** `lib/worktree.ts`

```ts
import type { Flags, Stage } from "./types";
import { atOrSafer } from "./types";
import { scopeOfPath } from "./agent";
export type WorktreeInfo = {
  path: string;
  isInvariant: boolean;
  hasBranch: boolean;
  isUntouched: boolean;
  hasUncommittedChanges: boolean;
  isMerged: boolean;
};
export type CleanupDecisionResult = { remove: true } | { remove: false; reason: string };
function worktreeStage(info: WorktreeInfo): Stage {
  if (info.hasUncommittedChanges) return "files-changed";
  if (info.isMerged) return "merged";
  return "committed";
}
// yolo は flags に展開済みなので判定に yolo 分岐は無い
export function decideWorktree(info: WorktreeInfo, flags: Flags): CleanupDecisionResult {
  if (info.isInvariant) return { remove: false, reason: "protected" };
  if (!info.hasBranch) return flags.detached ? { remove: true } : { remove: false, reason: "detached" };
  if (info.isUntouched) return flags.untouched ? { remove: true } : { remove: false, reason: "untouched" };
  const stage = worktreeStage(info);
  const threshold = flags.thresholds[scopeOfPath(info.path)];
  return atOrSafer(stage, threshold) ? { remove: true } : { remove: false, reason: stage };
}
```

- [ ] **成功確認** PASS(7) → commit `feat: add worktree deletion decision with thresholds and off-ladder toggles`

### Task 8: branch 判定（branch.ts 判定コア）

- [ ] **失敗テスト** `lib/branch.test.ts`

```ts
import { expect, test } from "vitest";
import { decideBranch, type BranchInfo } from "./branch";
import { defaultFlags } from "./flags";
function br(over: Partial<BranchInfo>): BranchInfo { return { name: "feature", isInvariant: false, classification: "other", ...over }; }
test("decideBranch keeps an invariant branch", () => {
  expect(decideBranch(br({ isInvariant: true }), defaultFlags()).remove).toBe(false);
});
test("decideBranch removes an in-base branch by default", () => {
  expect(decideBranch(br({ classification: "merged" }), defaultFlags()).remove).toBe(true);
  expect(decideBranch(br({ classification: "untouched" }), defaultFlags()).remove).toBe(true);
});
test("decideBranch keeps a committed branch by default and removes it at the committed threshold", () => {
  expect(decideBranch(br({ classification: "other" }), defaultFlags()).remove).toBe(false);
  const flags = { ...defaultFlags(), thresholds: { ...defaultFlags().thresholds, branch: "committed" as const } };
  expect(decideBranch(br({ classification: "other" }), flags).remove).toBe(true);
});
```

- [ ] **実装（判定コア）** `lib/branch.ts`

```ts
import type { Classification, Flags, Stage } from "./types";
import { atOrSafer } from "./types";
import type { CleanupDecisionResult } from "./worktree";
export type BranchInfo = { name: string; isInvariant: boolean; classification: Classification };
function branchStage(c: Classification): Stage { return c === "other" ? "committed" : "merged"; }
export function decideBranch(info: BranchInfo, flags: Flags): CleanupDecisionResult {
  if (info.isInvariant) return { remove: false, reason: "protected" };
  const stage = branchStage(info.classification);
  return atOrSafer(stage, flags.thresholds.branch) ? { remove: true } : { remove: false, reason: stage };
}
```

- [ ] **成功確認** PASS(4) → commit `feat: add branch deletion decision folding untouched into in-base`

---

## Milestone 4: 出力・収集・orchestration

### Task 9: 整形（format.ts）

- [ ] **失敗テスト** `lib/format.test.ts`

```ts
import { expect, test } from "vitest";
import { relpath, statusLine } from "./format";
test("relpath shortens the home directory to a tilde", () => {
  const home = process.env["HOME"] ?? "";
  expect(relpath(`${home}/repo/x`)).toBe("~/repo/x");
});
test("statusLine renders a kept item with its reason label without color", () => {
  const line = statusLine({ action: "kept", name: "wt", reason: "untouched" }, false);
  expect(line).toContain("untouched");
  expect(line).toContain("·");
});
test("statusLine renders a removed item with a check mark", () => {
  expect(statusLine({ action: "removed", name: "wt" }, false)).toContain("✓");
});
```

- [ ] **実装** `lib/format.ts`

```ts
import type { ActionResult } from "./types";
const BRAND = "192;255;57";
export function useColor(): boolean { return Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"]; }
export function hi(s: string, color = useColor()): string { return color ? `\u001b[38;2;${BRAND}m${s}\u001b[0m` : s; }
export function bold(s: string, color = useColor()): string { return color ? `\u001b[1m${s}\u001b[0m` : s; }
export function dim(s: string, color = useColor()): string { return color ? `\u001b[2m${s}\u001b[0m` : s; }
export function relpath(p: string): string {
  const home = process.env["HOME"];
  if (!home) return p;
  if (p === home) return "~";
  if (p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
  return p;
}
export function statusLine(result: ActionResult, color = useColor()): string {
  const name = relpath(result.name);
  switch (result.action) {
    case "removed": return `  ${hi("✓", color)}  ${name}`;
    case "would-remove": return `  ${hi("→", color)}  ${name}`;
    case "failed": return `  ${hi("✗", color)}  ${name}  ${result.error}`;
    case "kept": {
      const pad = Math.max(2, 38 - name.length);
      const line = `  ·  ${name}${" ".repeat(pad)}${result.reason}`;
      return color ? `\u001b[2m${line}\u001b[0m` : line;
    }
  }
}
```

- [ ] **成功確認** PASS(3) → commit `feat: port color and status-line formatting`

### Task 10: brand / logo（brand.ts）

- [ ] **失敗テスト** `lib/brand.test.ts`

```ts
import { expect, test } from "vitest";
import { logo } from "./brand";
test("logo contains the wordmark letters", () => {
  const out = logo(false);
  expect(out).toContain("G I T");
  expect(out).toContain("H A R V E S T");
});
```

- [ ] **実装** `lib/brand.ts`（bash `print_logo` を移植）

```ts
const BRAND = "192;255;57";
const LINES = [
  " \\|/                     \\|/",
  "\\\\|//  ~~~~~~~~~~~~~~~  \\\\|//",
  " \\|/        G I T        \\|/",
  "  |     H A R V E S T     |",
  " _|_______________________|_",
];
export function logo(color = Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"]): string {
  const body = LINES.map((l) => (color ? `\u001b[38;2;${BRAND}m${l}\u001b[0m` : l)).join("\n");
  return `\n${body}\n`;
}
```

- [ ] **成功確認** PASS(1) → commit `feat: port brand logo`

### Task 11: git 収集 + 実削除（cleanup orchestration）

`lib/worktree.ts` に `cleanupWorktrees`、`lib/branch.ts` に `cleanupBranches` を追記。porcelain 解析・invariant 判定（main/current cwd/locked/session/current HEAD/checked-out）・dry-run 分岐・`git`(tolerant) で 1 件ずつ実削除（`is not a working tree`/`not found` は no-op 成功化）・branch は survivingPaths で checked-out を invariant 化。

- [ ] **integration テスト** `lib/worktree.test.ts` 追記

```ts
import { cleanupWorktrees } from "./worktree";
import { makeRepo } from "./test-helpers";
// main にマージ済みの linked worktree は default で削除
test("cleanupWorktrees removes a merged linked worktree by default", async () => {
  await using repo = await makeRepo();
  await repo.git("switch", "-c", "done");
  await repo.commit("done work");
  await repo.git("switch", "main");
  await repo.git("merge", "--no-ff", "done", "-m", "merge done");
  const wtPath = `${repo.dir}-done`;
  await repo.git("worktree", "add", wtPath, "done");
  const result = await cleanupWorktrees(repo.dir, "main", defaultFlags(), { cwd: repo.dir });
  expect(result.results.some((r) => r.action === "removed" && r.name === wtPath)).toBe(true);
});
```

- [ ] **実装 `cleanupWorktrees`**（`lib/worktree.ts` 追記）

```ts
import { realpathSync } from "node:fs";
import type { CleanupResult, Flags } from "./types";
import { git, gitExitOk, gitText } from "./git";
import { hasRunningClaudeSession } from "./agent";
import { classifyBranch } from "./merge-detect";
type Opts = { cwd?: string };
function canonical(p: string): string { try { return realpathSync(p); } catch { return p; } }
type WtRecord = { path: string; branch?: string; locked: boolean };
async function listWorktrees(opts: Opts): Promise<WtRecord[]> {
  const out = await gitText(["worktree", "list", "--porcelain"], opts);
  const records: WtRecord[] = [];
  let cur: WtRecord | undefined;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) { cur = { path: line.slice(9), locked: false }; records.push(cur); }
    else if (cur && line.startsWith("branch ")) cur.branch = line.slice("branch refs/heads/".length);
    else if (cur && line.startsWith("locked")) cur.locked = true;
  }
  return records;
}
async function hasUncommitted(wt: string): Promise<boolean> {
  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "HEAD"]))) return true;
  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "--cached"]))) return true;
  return (await git(["-C", wt, "ls-files", "--others", "--exclude-standard"])).stdout.trim().length > 0;
}
export async function cleanupWorktrees(base: string, _baseName: string, flags: Flags, opts: Opts = {}): Promise<CleanupResult> {
  const records = await listWorktrees(opts);
  const mainPath = records[0]?.path ? canonical(records[0].path) : "";
  const current = canonical(opts.cwd ?? process.cwd());
  const results: CleanupResult["results"] = [];
  const survivingPaths: string[] = [];
  let failures = 0;
  for (const rec of records.slice(1)) {
    const path = rec.path;
    const canon = canonical(path);
    const isInvariant = canon === mainPath || canon === current || rec.branch === base || rec.locked || hasRunningClaudeSession(path);
    const uncommitted = await hasUncommitted(path);
    let isUntouched = false;
    let isMerged = false;
    if (rec.branch) {
      const c = await classifyBranch(rec.branch, base, opts);
      isUntouched = c === "untouched" && !uncommitted;
      isMerged = c === "merged";
    }
    const decision = decideWorktree({ path, isInvariant, hasBranch: Boolean(rec.branch), isUntouched, hasUncommittedChanges: uncommitted, isMerged }, flags);
    if (!decision.remove) { results.push({ action: "kept", name: path, reason: decision.reason }); survivingPaths.push(canon); continue; }
    if (flags.dryRun) { results.push({ action: "would-remove", name: path }); continue; }
    const { code, stdout } = await git(["worktree", "remove", "--force", path], opts);
    if (code === 0 || /is not a working tree/.test(stdout)) results.push({ action: "removed", name: path });
    else { results.push({ action: "failed", name: path, error: `exit ${code}` }); failures += 1; survivingPaths.push(canon); }
  }
  if (!flags.dryRun) await git(["worktree", "prune"], opts);
  return { results, failures, survivingPaths };
}
```

- [ ] **実装 `cleanupBranches`**（`lib/branch.ts` 追記）

```ts
import type { CleanupResult, Flags } from "./types";
import { git, gitText } from "./git";
import { classifyBranch } from "./merge-detect";
type Opts = { cwd?: string };
export async function cleanupBranches(base: string, flags: Flags, survivingPaths: string[], opts: Opts = {}): Promise<CleanupResult> {
  const branchesOut = await gitText(["branch", "--format=%(refname:short)"], opts);
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  const checkedOut = new Set<string>();
  const porcelain = await gitText(["worktree", "list", "--porcelain"], opts);
  let curPath = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) curPath = line.slice(9);
    else if (line.startsWith("branch ") && survivingPaths.includes(curPath)) checkedOut.add(line.slice("branch refs/heads/".length));
  }
  const results: CleanupResult["results"] = [];
  let failures = 0;
  for (const name of branchesOut.split("\n").map((b) => b.trim()).filter(Boolean)) {
    if (name === base) continue;
    const isInvariant = name === currentHead || checkedOut.has(name);
    const classification = await classifyBranch(name, base, opts);
    const decision = decideBranch({ name, isInvariant, classification }, flags);
    if (!decision.remove) { results.push({ action: "kept", name, reason: decision.reason }); continue; }
    if (flags.dryRun) { results.push({ action: "would-remove", name }); continue; }
    const { code, stdout } = await git(["branch", "-D", name], opts);
    if (code === 0 || /not found/.test(stdout)) results.push({ action: "removed", name });
    else { results.push({ action: "failed", name, error: `exit ${code}` }); failures += 1; }
  }
  return { results, failures, survivingPaths };
}
```

- [ ] **成功確認** PASS → commit `feat: collect git state and execute fail-tolerant cleanup`

### Task 12: orchestration + help（cli.ts）

- [ ] **helpText()** を `lib/flags.ts` に追記（`docs/flag-redesign.md` の help text 案そのまま）
- [ ] **失敗テスト** `lib/cli.test.ts`

```ts
import { expect, test } from "vitest";
import { resolveBase } from "./cli";
import { makeRepo } from "./test-helpers";
test("resolveBase resolves the default branch from origin/HEAD", async () => {
  await using repo = await makeRepo();
  expect(await resolveBase({ cwd: repo.dir })).toBe("main");
});
test("resolveBase fails closed when origin/HEAD cannot be determined", async () => {
  await using repo = await makeRepo();
  await repo.git("remote", "remove", "origin");
  await repo.git("symbolic-ref", "-d", "refs/remotes/origin/HEAD").catch(() => "");
  process.exitCode = 0;
  expect(await resolveBase({ cwd: repo.dir, offline: true })).toBeUndefined();
});
```

- [ ] **実装** `lib/cli.ts`

```ts
import pkg from "../package.json" with { type: "json" };
import { cleanupBranches } from "./branch";
import { logo } from "./brand";
import { gitText } from "./git";
import { helpText, parseArgs, UsageError } from "./flags";
import { bold, dim, hi, statusLine, useColor } from "./format";
import { cleanupWorktrees } from "./worktree";
type ResolveOpts = { cwd?: string; offline?: boolean };
export async function resolveBase(opts: ResolveOpts = {}): Promise<string | undefined> {
  const strip = (ref: string): string => ref.replace(/^refs\/remotes\/origin\//, "");
  let base = await gitText(["symbolic-ref", "refs/remotes/origin/HEAD"], opts).then(strip).catch(() => "");
  if (!base && !opts.offline) {
    await gitText(["-c", "http.connectTimeout=3", "remote", "set-head", "origin", "--auto"], opts).catch(() => "");
    base = await gitText(["symbolic-ref", "refs/remotes/origin/HEAD"], opts).then(strip).catch(() => "");
  }
  if (!base) {
    process.stderr.write("git-harvest: cannot determine default branch (try: git remote set-head origin <branch>)\n");
    process.exitCode = 1;
    return undefined;
  }
  return base;
}
export async function main(argv: string[]): Promise<void> {
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (error) {
    const message = error instanceof UsageError ? error.message : String(error);
    process.stderr.write(`git-harvest: ${message}\n\n${helpText()}`);
    process.exitCode = 1;
    return;
  }
  if (parsed.mode === "help") { process.stdout.write(helpText()); return; }
  if (parsed.mode === "version") { process.stdout.write(`git-harvest v${pkg.version}\n`); return; }
  if (parsed.mode === "logo") { process.stdout.write(`${logo()}\n`); return; }
  const base = await resolveBase();
  if (base === undefined) return;
  process.stdout.write(`\n${bold("git harvest", useColor())}\n`);
  if (parsed.flags.dryRun) process.stdout.write(`\n${dim("Dry run mode - nothing will be deleted")}\n`);
  const wt = await cleanupWorktrees(base, base, parsed.flags);
  const br = await cleanupBranches(base, parsed.flags, wt.survivingPaths);
  if (wt.results.length) process.stdout.write(`\n${bold("Worktrees")}\n${wt.results.map((r) => statusLine(r)).join("\n")}\n`);
  if (br.results.length) process.stdout.write(`\n${bold("Branches")}\n${br.results.map((r) => statusLine(r)).join("\n")}\n`);
  const n = [...wt.results, ...br.results].filter((r) => r.action === "removed" || r.action === "would-remove").length;
  process.stdout.write(n ? `\n${hi("✓")} ${bold(`Harvested ${n} item(s)`)}\n\n` : `\n${dim("· Nothing to harvest. All growing.")}\n\n`);
  process.exitCode = wt.failures + br.failures > 0 ? 2 : 0;
}
await main(process.argv.slice(2));
```

`tsconfig.json` に `"resolveJsonModule": true` が無ければ追加。

- [ ] **成功確認 + smoke** `pnpm vitest run lib/cli.test.ts && pnpm build && node bin/git-harvest --help | head -3 && node bin/git-harvest --version`
- [ ] commit `feat: orchestrate cleanup with base resolution and summary output`

---

## Milestone 5: 配布・バージョン・ドキュメント・後始末

### Task 13: 旧 bash と install スクリプト除去

- [ ] `git rm lib/git-harvest install.sh uninstall.sh`、`package.json` の `install:local`/`uninstall:local` 削除
- [ ] `pnpm vitest run && pnpm build && node bin/git-harvest -n`
- [ ] commit `feat: replace bash implementation with TypeScript build`

### Task 14: README（en/ja）+ CLAUDE.md 更新

- [ ] `README.ja.md` の Options/Usage/「動作内容」表を新 surface に（progression 冒頭明示、新 default = 全 scope merged のみ削除）
- [ ] `README.md` を同一構成で英訳
- [ ] `CLAUDE.md`: 本番コードを `lib/*.ts`（tsdown → `dist/git-harvest`）に、help チェックリスト参照を `lib/flags.ts` の `helpText()` に
- [ ] `node bin/git-harvest --help` と README の Options 一致を目視
- [ ] commit `docs: rewrite README and CLAUDE.md for scope-as-value flags`

### Task 15: リリース配線（0.3.0）と CI

- [ ] `.gitignore` に `dist/` 追加
- [ ] test workflow に `pnpm build && node bin/git-harvest --version` smoke 追加
- [ ] release workflow を npm publish に寄せ単体バイナリ `upload-assets` 削除。`package.json` に `"prepublishOnly": "pnpm build"`
- [ ] `feat:` のみで 0.2.3 → 0.3.0 を release-please dry-run で確認
- [ ] commit `chore: build in CI and publish to npm, drop single-binary assets`

### Task 16: 最終ゲート + doc リンク

- [ ] `pnpm eslint . && pnpm exec tsc --noEmit && pnpm vitest run && pnpm build && node bin/git-harvest -n`（全通過）
- [ ] `docs/flag-redesign.md` 末尾に「実装計画: `docs/flag-redesign-plan.md`」を 1 行
- [ ] commit `docs: link implementation plan from the design doc`

---

## Self-Review（実装前チェック結果）

- **Spec coverage:** `docs/flag-redesign.md` の各節をマップ済み — stage(T1) / scope per-tool(T5,7) / off-ladder untouched・detached(T6,7) / フラグ surface(T6) / `--yolo`=4 フラグの束(T6 等価テスト) / 判定 pseudo(T7,8) / invariant(T11) / base fail-closed(T12) / 出力 status ラベル(T9,12) / 命名 README(T14) / 配布 npm(T3,15) / 0.3.0(T3,15)。codex-worktree は意図的にスコープ外（将来 1 行追加）。
- **Placeholder scan:** 各コード step に実コードあり。codex matcher は「将来追加」と明示。
- **Type consistency:** `Flags`(types) / `Parsed`・`UsageError`(flags) / `WorktreeInfo`・`CleanupDecisionResult`・`decideWorktree`・`cleanupWorktrees`(worktree) / `BranchInfo`・`decideBranch`・`cleanupBranches`(branch) / `classifyBranch`(merge-detect) / `scopeOfPath`・`hasRunningClaudeSession`(agent) / `statusLine`(format) / `logo`(brand) / `resolveBase`・`main`(cli) を全タスクで同名・同シグネチャ。
- **既知の注意:** (1) `using`/`Symbol.asyncDispose` は tsconfig の `lib`/`target` が ES2022+ 必要（不可なら `lib` に `esnext.disposable` 追加）。(2) `with { type: "json" }` import は tsdown が静的インライン化する前提。(3) `cleanupWorktrees` の `hasUncommitted` はメモ化して呼び出し回数を減らしてよい（挙動不変）。
