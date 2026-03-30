# git-harvest

[English](./README.md) | 日本語

merge 済み branch と worktree を自動で整理するツール

## インストール

### Shell (macOS/Linux) (recommended)

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/install.sh | bash
```

ターミナルを再起動するか `source ~/.zshrc` を実行すると git-harvest が使えるようになります。

### Homebrew

```sh
brew install nozomiishii/tap/git-harvest
```

### (任意) エイリアスを設定

エイリアスを設定するとより手軽に実行できます。両方設定しても片方だけでも設定できます:

`ghv`
```sh
# シェルエイリアス
echo "alias ghv='git-harvest'" >> ~/.zshrc
```

`git harvest`
```sh
# Git サブコマンド — `git harvest` で実行可能
git config --global alias.harvest '!git-harvest'
```


## アンインストール

```sh
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/uninstall.sh | bash
```

## インストールせずに直接実行

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

## おすすめの運用法

Git hooksのpost-mergeコマンドと合わせることで、Mergeやpullした際に自動で収穫もできます。

### [lefthook](https://github.com/evilmartians/lefthook)との連携

Git Hooks にはhusky、pre-commit、simple-git-hooks など様々なツールがありますが、Lefthook が言語に依存せず monorepo にも組み込みやすいのでおすすめです。さらに lefthook-local.yaml を使えば、チーム開発で他のメンバーに影響を与えず自分だけ実行する運用も可能です。


```yaml
# lefthook-local.yaml
post-merge:
  commands:
    git-harvest:
      run: npx -y git-harvest@latest
      # or: bunx git-harvest@latest
      # or: pnpx git-harvest@latest
```


## 動作内容

1. `origin/HEAD` からデフォルトブランチ（main/master）を検出
2. デフォルトブランチにマージ済みのローカルブランチを特定（squash merge 含む）
3. マージ済みブランチに紐づく worktree を削除
4. マージ済みブランチを削除
5. リモートで削除済みの追跡ブランチを整理（`git fetch --prune`）

### ステータス表示

git-harvest は全ての worktree・ブランチの状態を表示します。

#### Worktree

| 状態 | 表示 | 説明 | 挙動 |
|---|---|---|---|
| マージ済み + 変更なし | `[DELETED]` / `[WILL DELETE]` | 収穫対象 | 削除 |
| マージ済み + 未コミット変更あり | `[GROWING] (uncommitted changes)` | 未保存の作業があるためスキップ | 残す |
| 未マージ | `[GROWING] (not merged)` | まだマージされていない | 残す |
| 独自コミットなし | `[GROWING] (no unique commits)` | 作成直後でまだ作業が始まっていない | 残す |
| メインワーキングツリー | *(表示なし)* | 常に除外 | 残す |
| デフォルトブランチ | *(表示なし)* | 常に除外 | 残す |

#### ブランチ

| 状態 | 表示 | 説明 | 挙動 |
|---|---|---|---|
| マージ済み + 削除可能 | `[DELETED]` / `[WILL DELETE]` | 収穫対象 | 削除 |
| マージ済み + チェックアウト中 | `[GROWING] (currently checked out)` | 現在使用中のためスキップ | 残す |
| 未マージ | `[GROWING] (not merged)` | まだマージされていない | 残す |
| 独自コミットなし | `[GROWING] (no unique commits)` | 作成直後でまだ作業が始まっていない | 残す |
| デフォルトブランチ | *(表示なし)* | 常に除外 | 残す |

### Squash merge の検出方法

`git commit-tree` で仮想 squash コミットを作成し、`git cherry` でデフォルトブランチに含まれているかを判定します。`git branch --merged` では検出できない squash merge を正しく検出できます。

