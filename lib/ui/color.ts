// ANSI エスケープシーケンスの先頭につく制御文字（0x1b）
const ESC = String.fromCodePoint(27);
const BRAND = "192;255;57";

export function bold(s: string, isColorEnabled = isColorSupported()): string {
  return isColorEnabled ? `${ESC}[1m${s}${ESC}[0m` : s;
}

export function dim(s: string, isColorEnabled = isColorSupported()): string {
  return isColorEnabled ? `${ESC}[2m${s}${ESC}[0m` : s;
}

export function hi(s: string, isColorEnabled = isColorSupported()): string {
  return isColorEnabled ? `${ESC}[38;2;${BRAND}m${s}${ESC}[0m` : s;
}

// 実行環境が色を出してよいか。各関数の isColorEnabled 引数の既定値になる
// （引数側は「この呼び出しで色を出すか」なので、環境判定とは別の名前にしている）
export function isColorSupported(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}
