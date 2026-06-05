# CLAUDE.md

## CLI 変更時のチェックリスト

コマンド・オプション・サブコマンドを追加・変更・削除した場合は、以下を必ず同時に更新する:

1. `lib/git-harvest` の help テキスト（`--help` 出力）
2. `README.md` の Options / Usage セクション
3. `README.ja.md` の対応セクション

## アーキテクチャ概要

マージ済みブランチと worktree を自動で整理する CLI ツール。

- **本番コード**: `lib/git-harvest`（shell スクリプト、ビルド不要）
- **テスト**: `lib/git-harvest.test.ts`（vitest、Integration Test）
- **配布**: npm publish で shell スクリプトを直接配布
- **デモ**: `demo/` — VHS + Docker でロゴ GIF を生成（`bash demo/create.sh`）

## 動作内容

- 各リソースの状態と挙動（通常 / `--all`）は `README.ja.md` の「動作内容」セクションの表を参照
- マージ検出は4段階フォールバック（first-parent → ancestor → 仮想 squash → cherry-pick）。詳細は `lib/git-harvest` の `main()` 内を参照

## ブランドカラー

定義・由来・使用箇所は [docs/brand-color.md](docs/brand-color.md) を参照。
