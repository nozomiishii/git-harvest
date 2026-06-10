import { realpathSync } from "node:fs";
import nodePath from "node:path";
import type { CleanupDecisionResult, CleanupResult, Flags, Stage } from "./types";
import { hasRunningClaudeSession, scopeOfPath } from "./agent";
import { git, gitExitOk, gitText } from "./git";
import { classifyBranch } from "./merge-detect";
import { atOrSafer } from "./types";

export type WorktreeInfo = {
  hasBranch: boolean;
  hasUncommittedChanges: boolean;
  invariantReason: string | undefined;
  isMerged: boolean;
  isUntouched: boolean;
  path: string;
};

type Opts = { cwd?: string };

type WtRecord = { branch: string | undefined; locked: boolean; path: string };

export async function cleanupWorktrees(
  base: string,
  flags: Flags,
  opts: Opts = {},
): Promise<CleanupResult> {
  const records = await listWorktrees(opts);
  const first = records[0];
  const mainPath = first ? canonical(first.path) : "";
  const current = canonical(opts.cwd ?? process.cwd());
  const invariantOf = (rec: WtRecord, canon: string): string | undefined => {
    if (canon === mainPath) {
      return "main";
    }

    // cwd が worktree 直下でもサブディレクトリでも current 扱い（sep 付き比較で /wt-foo の前方一致誤判定を防ぐ）
    if ((current + nodePath.sep).startsWith(canon + nodePath.sep)) {
      return "current";
    }

    if (rec.branch === base) {
      return "base branch";
    }

    if (rec.locked) {
      return "locked";
    }

    if (hasRunningClaudeSession(rec.path)) {
      return "session running";
    }

    return undefined;
  };
  const results: CleanupResult["results"] = [];
  // main worktree はループ対象外（slice(1)）だが常に生存するので、checked out 保護のため先に入れる
  const survivingPaths: string[] = mainPath ? [mainPath] : [];

  for (const rec of records.slice(1)) {
    const path = rec.path;
    const canon = canonical(path);

    try {
      const invariantReason = invariantOf(rec, canon);
      const uncommitted = await hasUncommitted(path);
      const classification =
        rec.branch === undefined ? undefined : await classifyBranch({ base, branch: rec.branch }, opts);
      const decision = decideWorktree(
        {
          hasBranch: rec.branch !== undefined,
          hasUncommittedChanges: uncommitted,
          invariantReason,
          isMerged: classification === "merged",
          isUntouched: classification === "untouched" && !uncommitted,
          path,
        },
        flags,
      );

      if (!decision.remove) {
        results.push({ action: "kept", name: path, reason: decision.reason });
        survivingPaths.push(canon);
        continue;
      }

      if (flags.dryRun) {
        results.push({ action: "would-remove", name: path });
        continue;
      }
      const { code, stderr } = await git(["worktree", "remove", "--force", path], opts);

      // "is not a working tree" は別プロセスが先に消した競合なので removed 扱い（エラーは stderr に出る）
      if (code === 0 || stderr.includes("is not a working tree")) {
        results.push({ action: "removed", name: path });
      } else {
        results.push({
          action: "failed",
          error: `exit ${String(code)}: ${stderr.trim()}`,
          name: path,
        });
        survivingPaths.push(canon);
      }
    } catch (error) {
      // 1 件の throw（壊れた ref で classifyBranch が rev-parse 失敗 等）で全体を止めない
      results.push({ action: "failed", error: String(error), name: path });
      survivingPaths.push(canon);
    }
  }

  if (!flags.dryRun) {
    await git(["worktree", "prune"], opts);
  }
  const failures = results.filter((r) => r.action === "failed").length;

  return { failures, results, survivingPaths };
}

// yolo は flags に展開済みなので判定に yolo 分岐は無い
export function decideWorktree(info: WorktreeInfo, flags: Flags): CleanupDecisionResult {
  if (info.invariantReason) {
    return { reason: info.invariantReason, remove: false };
  }

  if (!info.hasBranch) {
    return flags.detached ? { remove: true } : { reason: "detached", remove: false };
  }

  if (info.isUntouched) {
    return flags.untouched ? { remove: true } : { reason: "untouched", remove: false };
  }
  const stage = worktreeStage(info);
  const threshold = flags.thresholds[scopeOfPath(info.path)];

  return atOrSafer(stage, threshold) ? { remove: true } : { reason: stage, remove: false };
}

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

async function hasUncommitted(wt: string): Promise<boolean> {
  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "HEAD"]))) {
    return true;
  }

  if (!(await gitExitOk(["-C", wt, "diff", "--quiet", "--cached"]))) {
    return true;
  }
  const others = await git(["-C", wt, "ls-files", "--others", "--exclude-standard"]);

  return others.stdout.trim().length > 0;
}

async function listWorktrees(opts: Opts): Promise<WtRecord[]> {
  const out = await gitText(["worktree", "list", "--porcelain"], opts);

  // porcelain はエントリごとに空行区切り。各エントリは worktree 行 + 任意の branch / locked 行
  return out
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");

      return {
        branch: lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length),
        locked: lines.some((l) => l.startsWith("locked")),
        path: lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? "",
      };
    })
    .filter((rec) => rec.path !== "");
}

function worktreeStage(info: WorktreeInfo): Stage {
  if (info.hasUncommittedChanges) {
    return "files-changed";
  }

  if (info.isMerged) {
    return "merged";
  }

  return "committed";
}
