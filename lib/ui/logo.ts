import { readFileSync } from "node:fs";
import { hi, useColor } from "./color";

// VHS 風ロゴ。logo.ascii を単一の真実として読む。
// dev (tsx) は lib/ui/logo.ascii、build (tsdown) は dist/logo.ascii を指す（tsdown.config.ts でコピー）
export const logoArt = readFileSync(new URL("logo.ascii", import.meta.url), "utf8");

export function logo(color = useColor()): string {
  const body = logoArt
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => hi(line, color))
    .join("\n");

  return `\n${body}\n`;
}
