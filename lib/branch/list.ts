import { gitText } from "../git/exec";

type Opts = { cwd?: string };

// ローカルブランチの一覧を素のブランチ名で返す。
// refs/heads = ローカルブランチの置き場。for-each-ref はその一覧をスクリプト向けに出し、
// lstrip=2 で "refs/heads/foo" を "foo" にする。refs/heads 配下だけを出すので
// detached のプレースホルダ行が混ざらず、同名 tag があっても曖昧性解消名（heads/x）にならない
export async function listLocalBranches(opts: Opts = {}): Promise<string[]> {
  const out = await gitText(
    ["for-each-ref", "refs/heads", "--format=%(refname:lstrip=2)"],
    opts,
  );

  // 空リポジトリでは出力が空文字になり split が [""] を返すため除外する
  return out.split("\n").filter((name) => name !== "");
}
