# CLAUDE.md

このリポジトリで Claude Code (claude.ai/code) が作業する際のガイドラインです。

## 言語

- **応答言語**: プラン説明や返答は常に日本語で行い、コードやコマンド、技術用語はそのまま使用してよい。
- **PR 本文**: プルリクエストの本文（body）は日本語で記述する。

## よく使うコマンド

```bash
# テスト実行
bun test

# 依存のインストール
bun install
```

## Git・GitHub 運用ルール

- PR のマージは必ずユーザーが手動で行う。AI アシスタントが `gh pr merge` や GitHub API 経由でマージを実行してはならない。
- PR の作成・更新・push は許可するが、マージの最終判断は常にユーザーに委ねること。
- PR タイトルは英語 semantic 形式で記述する。
- ブランチ保護は **GitHub Rulesets のみ**で管理する。従来の Branch Protection Rules は使用しない。
- Rulesets の bypass_actors は空（誰も bypass 不可）を維持する。

## テストスタイル

- テストタイトル（`test("...")` / `describe("...")`）は英語で記述する。
- テストの上に簡潔な日本語コメントを添える。
- テストファイルはソースと同じディレクトリに `{name}.test.ts` で配置する。

## README フォーマットルール

README.ja.md（日本語）と README.md（英語）は同じ構成を保つ。新しい項目を追加する際は両方を更新する。

## CLI 変更時のチェックリスト

コマンド・オプション・サブコマンドを追加・変更・削除した場合は、以下を必ず同時に更新する:

1. `lib/git-harvest` の help テキスト（`--help` 出力）
2. `README.md` の Options / Usage セクション
3. `README.ja.md` の対応セクション

## アーキテクチャ概要

マージ済みブランチと worktree を自動で整理する CLI ツール。

- **本番コード**: `lib/git-harvest`（shell スクリプト、ビルド不要）
- **テスト**: `lib/git-harvest.test.ts`（Bun test、Integration Test）
- **配布**: npm publish で shell スクリプトを直接配布
