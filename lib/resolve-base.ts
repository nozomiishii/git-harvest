import { gitText, NETWORK_TIMEOUT_MS } from "./git";

type ResolveOpts = { cwd?: string; offline?: boolean };

// base = 掃除の基準になるデフォルトブランチ（main 等）。
// origin/HEAD という「リモートのデフォルトブランチを指すポインタ」から解決する
export async function resolveBase(opts: ResolveOpts = {}): Promise<string | undefined> {
  const cached = await originHead(opts);

  if (cached) {
    return cached;
  }

  if (opts.offline !== true) {
    // remote set-head --auto = リモートに現在のデフォルトブランチを問い合わせて origin/HEAD を作り直す。
    // offline でも hook をブロックしないよう、ネットワークを伴うこの操作は上限時間で打ち切る
    await gitText(["remote", "set-head", "origin", "--auto"], {
      ...opts,
      timeoutMs: NETWORK_TIMEOUT_MS,
    }).catch(() => "");
    const refreshed = await originHead(opts);

    if (refreshed) {
      return refreshed;
    }
  }
  process.stderr.write(
    "git-harvest: cannot determine default branch (try: git remote set-head origin <branch>)\n",
  );
  process.exitCode = 1;

  return undefined;
}

// origin/HEAD が指す default branch 名。未設定なら ""
async function originHead(opts: ResolveOpts): Promise<string> {
  return gitText(["symbolic-ref", "refs/remotes/origin/HEAD"], opts)
    .then(stripOrigin)
    .catch(() => "");
}

function stripOrigin(ref: string): string {
  return ref.replace(/^refs\/remotes\/origin\//, "");
}
