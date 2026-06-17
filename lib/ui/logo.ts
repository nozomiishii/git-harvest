import { readFileSync } from "node:fs";
import { hi, useColor } from "./color";

export const logoArt = readFileSync(new URL("logo.ascii", import.meta.url), "utf8");

export function logo(color = useColor()): string {
  const body = logoArt
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => hi(line, color))
    .join("\n");

  return `\n${body}\n`;
}
