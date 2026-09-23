// ANSI エスケープシーケンスの先頭につく制御文字（0x1b）
const ESC = String.fromCodePoint(27);
const BRAND = "192;255;57";

/**
 * 文字列を太字で表示する。
 *
 * @param s - 表示する文字列。
 *
 * @param isColorEnabled - ANSI の装飾を付けるかどうか。
 *
 * @returns 色が有効なら ANSI の太字指定を付けた文字列。
 */
export function bold(s: string, isColorEnabled = isColorSupported()): string {
  return isColorEnabled ? `${ESC}[1m${s}${ESC}[0m` : s;
}

/**
 * 文字列を薄く表示する。
 *
 * @param s - 表示する文字列。
 *
 * @param isColorEnabled - ANSI の装飾を付けるかどうか。
 *
 * @returns 色が有効なら ANSI の薄字指定を付けた文字列。
 */
export function dim(s: string, isColorEnabled = isColorSupported()): string {
  return isColorEnabled ? `${ESC}[2m${s}${ESC}[0m` : s;
}

/**
 * 文字列をブランドカラーで表示する。
 *
 * @param s - 表示する文字列。
 *
 * @param isColorEnabled - ANSI の装飾を付けるかどうか。
 *
 * @returns 色が有効なら ANSI の色指定を付けた文字列。
 */
export function hi(s: string, isColorEnabled = isColorSupported()): string {
  return isColorEnabled ? `${ESC}[38;2;${BRAND}m${s}${ESC}[0m` : s;
}

/**
 * 標準出力で色を使えるか調べる。
 * 各装飾関数の isColorEnabled の既定値に使う。
 *
 * @returns TTY で NO_COLOR が未指定なら true。
 */
export function isColorSupported(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}
