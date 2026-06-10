// VHS 風ロゴ。String.raw でバックスラッシュをエスケープ無しのまま保持する
// （.ascii ファイル + 専用 loader だと tsx 実行（pnpm dev）で解決できないため、文字列定数で持つ）
export const logoArt = String.raw` \|/                     \|/
\\|//  ~~~~~~~~~~~~~~~  \\|//
 \|/        G I T        \|/
  |     H A R V E S T     |
 _|_______________________|_
`;
