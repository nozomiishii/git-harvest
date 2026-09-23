import { realpathSync } from "node:fs";
import nodePath from "node:path";

// current worktree 保護（worktree/cleanup.ts）と session 検出（agent/session.ts）は同じパス比較の規約に乗る必要がある。
// 片方だけ正規化を変えると保護が乖離するため、ここに 1 つだけ置く

/**
 * パスが親ディレクトリ自身またはその配下か調べる。
 * 区切り文字を加えて、名前の一部だけが一致するパスを除く。
 *
 * @param root0 - 比較する子パスと親パス。
 *
 * @param root0.child - 調べる子パス。
 *
 * @param root0.parent - 基準にする親パス。
 *
 * @returns 親自身かその配下なら true。
 */
export function isInside({ child, parent }: { child: string; parent: string }): boolean {
  return (child + nodePath.sep).startsWith(parent + nodePath.sep);
}

/**
 * 存在するパスを正規化し、失敗時は元の値を返す。
 *
 * @param target - 正規化または表示するパス。
 *
 * @returns 正規化できたパス、または元のパス。
 */
export function realpath(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}
