import { hi, useColor } from "./format";
import { logoArt } from "./logo";

export function logo(color = useColor()): string {
  const body = logoArt
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => hi(line, color))
    .join("\n");

  return `\n${body}\n`;
}
