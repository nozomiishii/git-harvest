# CLAUDE.md

## CLI 変更時のチェックリスト

コマンド・オプション・サブコマンドを追加・変更・削除した場合は、以下を必ず同時に更新する:

- `lib/cli.ts` の help テキスト（`--help` 出力）
- `README.md` の Options / Usage セクション
- `README.ja.md` の対応セクション

## アーキテクチャ概要

マージ済みブランチと worktree を自動で整理する CLI ツール。

- 本番コード: `lib/*.ts`（TypeScript。エントリは `lib/cli.ts`）
- ビルド: `tsdown`。npm 向け ESM バンドルを `dist/git-harvest` に出力
- テスト: `vitest run`。テストは `lib/*.test.ts`、共有ヘルパは `lib/test-helpers.ts`
- 設定: `vitest.config.ts` / `eslint.config.ts` / `tsconfig.json`
- デモ: `demo/` — VHS + Docker でロゴ GIF を生成（`bash demo/create.sh`）

## 動作内容

- 各リソースの状態と挙動（通常 / `--all`）は `README.ja.md` の「動作内容」セクションの表を参照
- マージ検出は4段階フォールバック（first-parent → ancestor → 仮想 squash → cherry-pick）。詳細は `lib/merge-detect.ts` の `classifyBranch()` を参照

## ブランドカラー

`#C0FF39` — Inabikari（rgb 192, 255, 57）

「稲光」: 古くから「雷光が稲を実らせる（稲の成長を促す）」と信じられていたことに由来しており、「稲妻」とほぼ同じ意味

- C = Crop（branch も worktree も harvest 対象）
- 0 → FF = 育ち始めから育ちきるまでな感じ
- 39 = サンクス！収穫！

メモ:
- コード内では「稲光」や「Inabikari」の名前は使わず `BRAND_COLOR` / `ブランドカラー` にする
- 使用箇所
    - wordmark `git harvest`
    - `✓` 成功マーカー
    - `→` will-delete マーカー
    - `logo` subcommand
- `·` 削除せず保護 と reason 文は dim gray
- エラーは terminal default red を維持して CLI 規約（red=error / yellow=warn）と衝突させない
- light terminal での視認性は犠牲にして(ごめん) dark terminal 前提（`#C0FF39` は L≈0.83 なので白背景では飛ぶ）
- `NO_COLOR=1` と 非 TTY ではプレーンテキスト fallback
