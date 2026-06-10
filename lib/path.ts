import { realpathSync } from "node:fs";
import nodePath from "node:path";

// current worktree 保護（worktree.ts）と session 検出（agent.ts）は同じパス比較の規約に乗る必要がある。
// 片方だけ正規化を変えると保護が乖離するため、ここに 1 つだけ置く

export function canonical(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

// child が parent 配下（parent 自身を含む）か。sep 付き比較で /wt-foo の前方一致誤判定を防ぐ
export function isInside({ child, parent }: { child: string; parent: string }): boolean {
  return (child + nodePath.sep).startsWith(parent + nodePath.sep);
}
