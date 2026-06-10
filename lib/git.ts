import { execFile } from "node:child_process";
import { env } from "node:process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// git コマンド実行の共通ラッパー 3 種。使い分け:
//   git()       失敗しても throw せず exit code ごと返す（失敗を自分で扱う処理用）
//   gitText()   出力文字列が欲しい時。失敗は throw
//   gitExitOk() 成功 / 失敗だけ知りたい時

// ネットワークを伴う git コマンド（set-head / remote prune）の上限時間。hook をブロックさせないための値
export const NETWORK_TIMEOUT_MS = 5000;

export type GitOpts = { cwd?: string; timeoutMs?: number };

export async function git(
  args: string[],
  opts: GitOpts = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  try {
    const { stderr, stdout } = await exec("git", args, {
      cwd: opts.cwd,
      // LC_ALL=C: stderr 照合（"not found" 等）が翻訳ロケールで壊れないようメッセージを固定。
      // GIT_TERMINAL_PROMPT=0: hook での自動実行前提なので認証プロンプトでブロックさせない
      env: { ...env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      maxBuffer: 64 * 1024 * 1024,
      // 0 は無制限。超過時は kill され、呼び出し側には非 0 の code として返る
      timeout: opts.timeoutMs ?? 0,
    });

    return { code: 0, stderr, stdout };
  } catch (error) {
    const e = error as { code?: number; stderr?: string; stdout?: string };

    return {
      code: typeof e.code === "number" ? e.code : 1,
      stderr: e.stderr ?? "",
      stdout: e.stdout ?? "",
    };
  }
}

export async function gitExitOk(args: string[], opts: GitOpts = {}): Promise<boolean> {
  const result = await git(args, opts);

  return result.code === 0;
}

export async function gitText(args: string[], opts: GitOpts = {}): Promise<string> {
  const { code, stdout } = await git(args, opts);

  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} exited with ${String(code)}`);
  }

  return stdout.trim();
}
