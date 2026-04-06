# `--all` flag design

## Context

git-harvest は現在マージ済みブランチと worktree のみを削除する。未マージのブランチやチェックアウト中のブランチ、未コミット変更のある worktree は保護される。

ユーザーが「デフォルトブランチ以外を全部消したい」場面に対応するため、`--all` フラグを追加する。

関連 Issue: #77 (将来の `--guarded`, `--growing`, `--force` フラグの候補)

## 動作

`--all` はデフォルトブランチとメインワーキングツリー以外の全リソースを削除する。マージ判定と保護チェックをすべてスキップする。

### 動作表

| リソース | 通常 | `--all` |
|---|---|---|
| メインワーキングツリー | 残る | 残る |
| デフォルトブランチ | 残る | 残る |
| WT (マージ済み、クリーン) | DELETED | DELETED |
| WT (マージ済み、未コミット変更) | GROWING | DELETED |
| WT (未マージ、クリーン) | GROWING | DELETED |
| WT (未マージ、未コミット変更) | GROWING | DELETED |
| ブランチ (マージ済み) | DELETED | DELETED |
| ブランチ (マージ済み、チェックアウト中) | GROWING | エラー終了 (`--dry-run` 時は WILL DELETE) |
| ブランチ (未マージ) | GROWING | DELETED |
| ブランチ (未マージ、チェックアウト中) | GROWING | エラー終了 (`--dry-run` 時は WILL DELETE) |

### チェックアウト中のブランチ

デフォルトブランチ以外をチェックアウト中に `--all` を実行すると、削除処理に入る前にエラーで終了する。何も削除されない。

```
$ git-harvest --all

  Error: Cannot delete branch 'feature-c' (currently checked out)
  Run: git checkout main && git-harvest --all

```

ただし `--dry-run --all` の場合はエラーにせず、全リソースを `[WILL DELETE]` で表示する（dry-run は「何が起きるか見せる」のが目的のため）。

### `--dry-run` との組み合わせ

`--dry-run --all` は全リソースを `[WILL DELETE]` で表示し、実際には削除しない。引数の順序は問わない。チェックアウト中のブランチも `[WILL DELETE]` で表示される。

## フラグ設計

- long flag のみ: `--all`
- short flag なし（破壊的操作のため、タイプ量を増やして誤実行を防ぐ）
- 確認プロンプトなし（`--all` を指定した時点でユーザーの意思とみなす）

## 実装箇所

対象ファイル: `lib/git-harvest`

### 1. 引数パース (L297-324)

現在の `case "${1:-}"` を `while` ループに変更し、複数引数に対応する。

```bash
DRY_RUN=false
DELETE_ALL=false

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version) echo "git-harvest v$VERSION"; exit 0 ;;
    --update) self_update ;;
    -n|--dry-run) DRY_RUN=true ;;
    --all) DELETE_ALL=true ;;
    -h|--help) # help text; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
```

### 2. 事前チェック (main 関数内、base 取得後)

`--dry-run` 時はスキップする（プレビューを表示するため）。

```bash
if [ "$DELETE_ALL" = true ] && [ "$DRY_RUN" = false ]; then
  local current
  current=$(git symbolic-ref --short HEAD 2>/dev/null) || true
  if [ -n "$current" ] && [ "$current" != "$base" ]; then
    echo "Error: Cannot delete branch '$current' (currently checked out)" >&2
    echo "  Run: git checkout $base && git-harvest --all" >&2
    exit 1
  fi
fi
```

### 3. マージ検出スキップ (main 関数内)

`DELETE_ALL=true` のとき、マージ済みブランチの検出ループを丸ごとスキップする。

### 4. cleanup_worktrees の変更

`DELETE_ALL=true` のとき:
- マージ判定をスキップし、デフォルトブランチ以外の全 worktree を削除対象にする
- `has_uncommitted_changes` チェックをスキップする
- `git worktree remove --force` を使用する

### 5. cleanup_branches の変更

`DELETE_ALL=true` のとき:
- マージ判定をスキップし、デフォルトブランチ以外の全ブランチを削除対象にする
- `is_current_head` / `is_checked_out_in_worktree` チェックは事前チェック (2) でカバー済みなので不要

### 6. help テキスト更新

```
Options:
  -h, --help     Show this help
  -v, --version  Show version
  -n, --dry-run  Show what would be deleted without actually deleting
  --all          Delete all branches and worktrees except the default branch
  --update       Update to the latest version
```

## テスト

対象ファイル: `lib/git-harvest.test.ts`

### 追加するテストケース

1. **`--all` でマージ済み + 未マージを全部削除する**
2. **`--all` でデフォルトブランチは残る**
3. **`--all` でメインワーキングツリーは残る**
4. **`--all` で未コミット変更のある worktree も削除する**
5. **`--all` でチェックアウト中のブランチはエラー終了する**
6. **`--all` のエラー時に何も削除されない**
7. **`--dry-run --all` で全リソースが `[WILL DELETE]` 表示される**
8. **`--all --dry-run` でも同じ動作（引数順序）**
9. **`--dry-run --all` でチェックアウト中のブランチも `[WILL DELETE]` 表示（エラーにならない）**
10. **不明なオプションでエラー終了する**

## 将来の拡張

#77 で議論中:

```
git-harvest               マージ済みを削除（保護あり）
git-harvest --guarded     マージ済みを削除（保護なし）
git-harvest --growing     未マージも含めて削除（保護あり）
git-harvest --all         全部削除（= --guarded --growing）
```

## スコープ外

- `[GUARDED]` ステータスの導入
- `--force`, `--guarded`, `--growing` フラグ
- README の更新（別 PR で対応）
