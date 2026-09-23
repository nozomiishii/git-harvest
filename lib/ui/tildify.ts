import { homedir } from "node:os";

/**
 * 表示用パスのホームディレクトリを ~ に短縮する。
 * ホームディレクトリの外では元のパスを返す。
 *
 * @param p - 表示するパス。
 *
 * @returns 短縮した表示用パス。
 */
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
