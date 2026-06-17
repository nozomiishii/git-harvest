import { gitText } from "../git/exec";

type Opts = { cwd?: string };

// ローカルブランチの一覧を「素のブランチ名」だけで返す。
// for-each-ref はリポジトリ内の ref を出力するコマンド。
// refs/heads/ を指定しているので、対象はローカルブランチに限定される
// （detached HEAD のプレースホルダ行や、同名 tag は混ざらない）。
// --format で出力形式を指定し、lstrip=2 は ref 名の先頭 2 階層
// （"refs/heads/"）を取り除いて branch 名そのものだけ出す
export async function listLocalBranches(opts: Opts = {}): Promise<string[]> {
  const out = await gitText(
    ["for-each-ref", "refs/heads", "--format=%(refname:lstrip=2)"],
    opts,
  );

  // 空リポジトリでは出力が空文字で、split が [""] を返してしまうので除外する
  return out.split("\n").filter((name) => name !== "");
}
