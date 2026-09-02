import { gitText, NETWORK_TIMEOUT_MS } from "../git/exec";

interface ResolveOpts {
  cwd?: string;
  offline?: boolean;
}

// base = 掃除の基準になるデフォルトブランチ（main 等）。
// origin/HEAD という「リモートのデフォルトブランチを指すポインタ」から解決する
export async function resolveBase(opts: ResolveOpts = {}): Promise<string | undefined> {
  const existing = await originHead(opts);

  if (existing) {
    return existing;
  }

  if (opts.offline !== true) {
    try {
      // remote set-head --auto = リモートに現在のデフォルトブランチを問い合わせて origin/HEAD を作り直す。
      // offline でも hook をブロックしないよう、ネットワークを伴うこの操作は上限時間で打ち切る
      await gitText(["remote", "set-head", "origin", "--auto"], {
        ...opts,
        timeoutMs: NETWORK_TIMEOUT_MS,
      });
    } catch {
      // オフライン等での失敗は許容する。作り直せなくても直後の originHead で結果を見る
    }
    const afterRefresh = await originHead(opts);

    if (afterRefresh) {
      return afterRefresh;
    }
  }

  return undefined;
}

// origin/HEAD が指す default branch 名。未設定なら ""
async function originHead(opts: ResolveOpts): Promise<string> {
  try {
    const ref = await gitText(["symbolic-ref", "refs/remotes/origin/HEAD"], opts);

    return stripOrigin(ref);
  } catch {
    // origin/HEAD が未設定なら symbolic-ref が失敗する。呼び出し側はこれを「未解決」として扱う
    return "";
  }
}

function stripOrigin(ref: string): string {
  return ref.replace(/^refs\/remotes\/origin\//, "");
}
