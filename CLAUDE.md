# CLAUDE.md

このリポジトリで Claude Code (claude.ai/code) が作業する際のガイドラインです。

## Git・GitHub 運用ルール

- PR タイトルは英語 semantic 形式で記述する。
- ブランチ保護は **GitHub Rulesets のみ**で管理する。従来の Branch Protection Rules は使用しない。
- Rulesets の bypass_actors は空（誰も bypass 不可）を維持する。
- `BREAKING CHANGE:` フッターは **`git-harvest` の公開 API（CLI のコマンド・オプション・出力フォーマット）の互換性を破る変更にのみ**使用する。CI / workflows / branch protection / リポジトリ運用上の変更には使わない（release-please が `bump-minor-pre-major: true` の設定下で minor bump を実行し、CHANGELOG に Breaking Changes として表示してしまうため。実例: PR #106 で workflow 移行を BREAKING CHANGE と書いたことで 0.1.x → 0.2.0 と誤判定された）。これらの注意事項は PR 本文に記述する。

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
- **デモ**: `demo/` — VHS + Docker でロゴ GIF を生成（`bash demo/create.sh`）

## Homebrew Formula 配布

`homebrew-tap/Formula/git-harvest.rb` の更新は **`homebrew-tap` 側の Renovate に委ねる**。release ワークフローからは `homebrew-update` ジョブを意図的に持たせていない。

- Renovate の `homebrew` manager が Formula の `url` / `sha256` を tarball 取得込みで自動更新する
- `nozomiishii/renovate` preset で `nozomiishii/*` は `minimumReleaseAge: null` のため、release 直後に PR が立つ
- preset の `automerge: true` で patch / minor は自動マージ（major のみ手動）

`mislav/bump-homebrew-formula-action` を使わない理由は以下のとおり:

- `homebrew-tap` の `main` は GitHub Rulesets で保護されているため、action 内部で `branchRes.data.protected === true` 判定により `update-<file>-<timestamp>` という別ブランチに commit を作成する経路に入る
- `create-pullrequest: false` のままだとその別ブランチを **PR にもしない**ため、commit がどこにもマージされず孤立ブランチだけが残る（実例: `update-git-harvest.rb-1777372050`）
- ジョブは "success" で終わるためサイレント失敗となり、Formula が更新されていないことに気付きづらい
- `create-pullrequest: true` に切り替えても Renovate と PR が二重発行される

そのため git-harvest 側からは Formula を直接いじらず、Renovate 一本に揃えている。

## 動作内容

- 各リソースの状態と挙動（通常 / `--all`）は `README.ja.md` の「動作内容」セクションの表を参照
- マージ検出は4段階フォールバック（first-parent → ancestor → 仮想 squash → cherry-pick）。詳細は `lib/git-harvest` の `main()` 内を参照
