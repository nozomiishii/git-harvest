// ANSI エスケープシーケンスの先頭につく制御文字（0x1b）
const ESC = String.fromCodePoint(27);
const BRAND = "192;255;57";

export function bold(s: string, color = useColor()): string {
  return color ? `${ESC}[1m${s}${ESC}[0m` : s;
}

export function dim(s: string, color = useColor()): string {
  return color ? `${ESC}[2m${s}${ESC}[0m` : s;
}

export function hi(s: string, color = useColor()): string {
  return color ? `${ESC}[38;2;${BRAND}m${s}${ESC}[0m` : s;
}

export function useColor(): boolean {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}
