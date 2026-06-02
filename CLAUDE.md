# CLAUDE.md

## CLI 変更時のチェックリスト

コマンド・オプション・サブコマンドを追加・変更・削除した場合は、以下を必ず同時に更新する:

- `lib/cli.ts` の help テキスト（`--help` 出力）
- `README.md` の Options / Usage セクション
- `README.ja.md` の対応セクション

## アーキテクチャ概要

マージ済みブランチと worktree を自動で整理する CLI ツール。
ファイルの責務と全体の流れは [docs/architecture.md](docs/architecture.md) を参照。

- 本番コード: `lib/*.ts`（TypeScript。エントリは `lib/cli.ts`）
- ビルド: `tsdown`。npm 向け ESM バンドルを `dist/git-harvest` に出力
- テスト: `vitest run`。テストは `lib/*.test.ts`、共有ヘルパは `lib/test-helpers.ts`
- 設定: `vitest.config.ts` / `eslint.config.ts` / `tsconfig.json`
- デモ: `demo/` — VHS + Docker でロゴ GIF を生成（`bash demo/create.sh`）

## 動作内容

- 各リソースの状態と挙動（通常 / `--all`）は `README.ja.md` の「動作内容」セクションの表を参照
- マージ検出は4段階フォールバック（first-parent → ancestor → 仮想 squash → cherry-pick）。詳細は `lib/merge-detect.ts` の `classifyBranch()` を参照

## ブランドカラー

定義・由来・使用箇所は [docs/brand-color.md](docs/brand-color.md) を参照。
