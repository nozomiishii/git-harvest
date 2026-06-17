import { homedir } from "node:os";

// home directory を "~" に短縮する表示用ユーティリティ。
// 完全な相対パス計算ではない（path.relative() とは別物）
export function tildify(p: string): string {
  const home = homedir();

  if (!home) {
    return p;
  }

  if (p === home) {
    return "~";
  }

  if (p.startsWith(`${home}/`)) {
    return `~${p.slice(home.length)}`;
  }

  return p;
}
