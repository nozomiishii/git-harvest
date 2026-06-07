const BRAND = "192;255;57";

const LINES = [
  String.raw` \|/                     \|/`,
  String.raw`\\|//  ~~~~~~~~~~~~~~~  \\|//`,
  String.raw` \|/        G I T        \|/`,
  "  |     H A R V E S T     |",
  " _|_______________________|_",
];

export function logo(color = process.stdout.isTTY && !process.env.NO_COLOR): string {
  const body = LINES.map((l) => (color ? `[38;2;${BRAND}m${l}[0m` : l)).join("\n");

  return `\n${body}\n`;
}
