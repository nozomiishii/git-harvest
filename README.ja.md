# git-harvest

[English](./README.md) | 日本語

マージ済みブランチと worktree を自動で整理するツール（squash merge 対応）。

## 使い方

```sh
# bun
bunx git-harvest@latest

# pnpm
pnpx git-harvest@latest

# npm
npx -y git-harvest@latest
```

### オプション

```sh
git-harvest --help     # ヘルプを表示
git-harvest --version  # バージョンを表示
```

## 動作内容

1. `origin/HEAD` からデフォルトブランチ（main/master）を検出
2. デフォルトブランチにマージ済みのローカルブランチを特定（squash merge 含む）
3. マージ済みブランチに紐づく worktree を削除
4. マージ済みブランチを削除
5. リモートで削除済みの追跡ブランチを整理（`git fetch --prune`）

### Squash merge の検出方法

`git commit-tree` で仮想 squash コミットを作成し、`git cherry` でデフォルトブランチに含まれているかを判定します。`git branch --merged` では検出できない squash merge を正しく検出できます。

## エイリアス設定

お好みでエイリアスを設定すると、より手軽に実行できます。両方設定しても問題ありませんし、好きな片方だけでも OK です:

```sh
# シェルエイリアス
alias ghv='bunx git-harvest@latest'

# Git サブコマンドとして登録 — `git harvest` で実行可能
git config --global alias.harvest '!bunx git-harvest@latest'
```

## lefthook との連携

```yaml
# lefthook.yaml
post-merge:
  commands:
    cleanup-merged:
      run: pnpx git-harvest@latest
      # or: bunx git-harvest@latest
      # or: npx -y git-harvest@latest
```
