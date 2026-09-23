import { gitText } from "../git/exec";

interface Opts {
  cwd?: string;
}

/**
 * ローカルブランチ名を列挙する。
 * refs/heads/ の ref だけを読み、同名 tag や detached HEAD の表示を除く。
 * lstrip=2 で refs/heads/ を取り除いて名前だけ返す。
 *
 * @param opts - Git を実行する作業ディレクトリなどの設定。
 *
 * @returns ローカルブランチ名の一覧。
 */
export async function listLocalBranches(opts: Opts = {}): Promise<string[]> {
  const out = await gitText(["for-each-ref", "refs/heads", "--format=%(refname:lstrip=2)"], opts);

  // 空リポジトリでは出力が空文字で、split が [""] を返してしまうので除外する
  return out.split("\n").filter((name) => name !== "");
}
