// ブランドカラー #C0FF39 rgb(192, 255, 57)。truecolor の SGR パラメータ列。
export const BRAND_COLOR = '192;255;57';

// logo.ascii の内容。ビルド後も自己完結させるためファイル読込ではなく定数で持つ。
// 各行はソースの logo.ascii と 1 文字単位で一致させる（バックスラッシュは TS で \\ にエスケープ）。
const LOGO_LINES = [
  String.raw` \|/                     \|/`,
  String.raw`\\|//  ~~~~~~~~~~~~~~~  \\|//`,
  String.raw` \|/        G I T        \|/`,
  '  |     H A R V E S T     |',
  ' _|_______________________|_',
];

// ロゴを返す。color=true で各行をブランドカラー着色、false でプレーン。
// 前後に空行を 1 つずつ入れて bash の print_logo と同じ見た目にする。
export function logo(color = true): string {
  const body = LOGO_LINES.map((line) => (color ? paint(line) : line)).join('\n');

  return `\n${body}\n`;
}

// 1 行をブランドカラーの truecolor で着色する。
function paint(line: string): string {
  return `\u001B[38;2;${BRAND_COLOR}m${line}\u001B[0m`;
}
