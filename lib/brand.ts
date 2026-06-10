import { useColor } from "./format";
import { logoArt } from "./logo";

const BRAND = "192;255;57";

export function logo(color = useColor()): string {
  const body = logoArt
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => (color ? `[38;2;${BRAND}m${line}[0m` : line))
    .join("\n");

  return `\n${body}\n`;
}
