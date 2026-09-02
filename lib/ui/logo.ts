import { readFileSync } from "node:fs";
import { hi, isColorSupported } from "./color";

export const logoArt = readFileSync(new URL("logo.ascii", import.meta.url), "utf-8");

export function logo(isColorEnabled = isColorSupported()): string {
  const body = logoArt
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => hi(line, isColorEnabled))
    .join("\n");

  return `\n${body}\n`;
}
