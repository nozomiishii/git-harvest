# git-harvest

[English](./README.md) | 日本語

マージ済みブランチと worktree を自動で整理するツール（squash merge 対応）。

## インストール

### Shell (macOS/Linux) (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/install.sh | bash
```

ターミナルを再起動するか `source ~/.zshrc` を実行すると git-harvest が使えるようになります。

エイリアスを設定するとより手軽に実行できます。両方設定しても片方だけでも OK です:

```sh
# シェルエイリアス
echo "alias ghv='git-harvest'" >> ~/.zshrc

# Git サブコマンド — `git harvest` で実行可能
git config --global alias.harvest '!git-harvest'
```

### Homebrew

```sh
brew install nozomiishii/tap/git-harvest
```

#### アンインストール

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/uninstall.sh | bash
```

### npm

インストールせずに直接実行:

```sh
# bun
bunx git-harvest@latest

# pnpm
pnpx git-harvest@latest

# npm
npx -y git-harvest@latest
```

## 使い方

```sh
git-harvest
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
