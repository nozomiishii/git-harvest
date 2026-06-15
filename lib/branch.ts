import type { ActionResult, CleanupResult, Flags, Stage } from "./types";
import { git, gitText, NETWORK_TIMEOUT_MS } from "./git";
import { isMerged, isUntouched } from "./merged";

type Opts = { cwd?: string };

// branch は作業ディレクトリを持たないので files-changed 段が無い。
// untouched も merged も「取り込み済み残骸」として merged 扱い。それ以外（未取り込みの独自コミット）は committed
export async function categorizeBranch(
  branch: string,
  base: string,
  opts: Opts = {},
): Promise<Stage> {
  const refs = { base, branch };

  if ((await isUntouched(refs, opts)) || (await isMerged(refs, opts))) {
    return "merged";
  }

  return "committed";
}

// ローカルブランチの一覧を取り、1 つずつ「守る / 分類 / 削除」する
export async function cleanupBranches(
  base: string,
  flags: Flags,
  survivingBranches: Set<string>,
  opts: Opts = {},
): Promise<CleanupResult> {
  // refs/heads = ローカルブランチの置き場。for-each-ref はその一覧をスクリプト向けに出し、
  // lstrip=2 で "refs/heads/foo" を "foo" にする。refs/heads 配下だけを出すので
  // detached のプレースホルダ行が混ざらず、同名 tag があっても曖昧性解消名（heads/x）にならない
  const branchesOut = await gitText(
    ["for-each-ref", "refs/heads", "--format=%(refname:lstrip=2)"],
    opts,
  );
  // symbolic-ref --short HEAD = 今 checkout 中のブランチ名。
  // detached HEAD（ブランチに居ない状態）では失敗するので ""（どの branch 名とも一致しない）
  const currentHead = await gitText(["symbolic-ref", "--short", "HEAD"], opts).catch(() => "");
  const results: ActionResult[] = [];

  // base 自身は掃除対象外（results にも出さない）。並列化しない: 直列 await で順序と index.lock を守る
  for (const name of listLocalBranches(branchesOut).filter((branchName) => branchName !== base)) {
    results.push(await sweepBranch(name, base, currentHead, survivingBranches, flags, opts));
  }

  if (!flags.dryRun) {
    // リモートで削除済みの追跡ブランチ (origin/*) を整理。fetch と違いオブジェクト転送をしない。
    // offline 等の失敗は無視（git は throw しない）し、hook をブロックしないよう上限時間で打ち切る
    await git(["remote", "prune", "origin"], { ...opts, timeoutMs: NETWORK_TIMEOUT_MS });
  }
  const failures = results.filter((r) => r.action === "failed").length;

  return { failures, results };
}

// 守る理由ごとの述語。どれか true ならその branch はどのフラグでも消さない

function isCheckedOut(name: string, survivingBranches: Set<string>): boolean {
  return survivingBranches.has(name);
}

function isCurrentHead(name: string, currentHead: string): boolean {
  return name === currentHead;
}

// 空リポジトリでは出力が空文字になり split が [""] を返すため除外する
function listLocalBranches(branchesOut: string): string[] {
  return branchesOut.split("\n").filter((name) => name !== "");
}

// 競合 rescue とエラー整形だけを持つ実行関数。
// branch -D は「base に取り込み済みか」を git 側で確認しない強制削除（-d は未マージを拒否する）。
// 取り込み済み確認は categorizeBranch で済んでいるため -D で良い
async function removeBranch(name: string, opts: Opts): Promise<ActionResult> {
  const { code, stderr } = await git(["branch", "-D", name], opts);

  // "not found" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
  if (code === 0 || stderr.includes("not found")) {
    return { action: "removed", name };
  }

  return { action: "failed", error: `exit ${String(code)}: ${stderr.trim()}`, name };
}

// committed の branch は --committed(=branch) があれば消す、なければ理由付きで残す
async function removeCommittedBranch(
  name: string,
  branchCommitted: boolean,
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult> {
  if (!branchCommitted) {
    return { action: "kept", name, reason: "committed" };
  }

  if (dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

// merged の branch は base 取り込み済みの残骸なので常に消す
async function removeMergedBranch(
  name: string,
  dryRun: boolean,
  opts: Opts,
): Promise<ActionResult> {
  if (dryRun) {
    return { action: "would-remove", name };
  }

  return removeBranch(name, opts);
}

// 1 branch → 1 結果。fail-soft の catch を内側に持ち、呼び出し側へは throw しない契約
async function sweepBranch(
  name: string,
  base: string,
  currentHead: string,
  survivingBranches: Set<string>,
  flags: Flags,
  opts: Opts,
): Promise<ActionResult> {
  try {
    // 守る理由を上から1つずつ確認。当たればその理由で残す
    if (isCurrentHead(name, currentHead)) {
      return { action: "kept", name, reason: "current HEAD" };
    }

    if (isCheckedOut(name, survivingBranches)) {
      return { action: "kept", name, reason: "checked out" };
    }
    const category = await categorizeBranch(name, base, opts);

    if (category === "merged") {
      return await removeMergedBranch(name, flags.dryRun, opts);
    }

    return await removeCommittedBranch(name, flags.branchCommitted, flags.dryRun, opts);
  } catch (error) {
    // 1 件の throw（壊れた ref 等）で全体を止めない
    return { action: "failed", error: String(error), name };
  }
}
