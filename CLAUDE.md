# CLAUDE.md

## CLI 変更時のチェックリスト

コマンド・オプション・サブコマンドを追加・変更・削除した場合は、以下を必ず同時に更新する:

1. `lib/flags.ts` の `helpText()`（`--help` 出力）
2. `README.md` の Options / Usage セクション
3. `README.ja.md` の対応セクション

## アーキテクチャ概要

ブランチと worktree を、コミットのライフサイクル段階に応じて自動で整理する CLI ツール。

- **本番コード**: `lib/*.ts`（TypeScript・単一責務の小モジュール）。tsdown でバンドルし `dist/cli.mjs` を生成
- **テスト**: `lib/<name>.test.ts`（vitest・ソースと同ディレクトリ）
- **配布**: `pnpm build`（tsdown）→ npm publish。`bin` は `dist/cli.mjs`
- **デモ**: `demo/` — VHS + Docker でロゴ GIF を生成（`bash demo/create.sh`）

## 動作内容

- フラグ・stage・scope・off-ladder・invariant・status ラベルは `README.ja.md` の「動作内容」セクションを参照。設計の経緯は [#169](https://github.com/nozomiishii/git-harvest/issues/169) を参照
- マージ検出は `lib/merged.ts` を参照。`isUntouched`（first-parent で独自コミット無しを判定）と `isMerged`（ancestor → 仮想 squash → cherry-pick の 3 段フォールバック）に分かれる

## ブランドカラー

定義・由来・使用箇所は [docs/brand-color.md](docs/brand-color.md) を参照。
