# git-harvest

[English](./README.md) | 日本語

<br>
<div align="center">
  <img src="demo/logo.gif" alt="logo" width="480" />
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/git-harvest"><img src="https://img.shields.io/npm/v/git-harvest.svg" alt="npm version" /></a>
</p>
<br>

branch と worktree を、コミットのライフサイクル段階に応じて自動で整理するツール

## お試し (`--dry-run`)

削除対象を表示するだけで、実際には何も削除しません:

```sh
npx -y git-harvest@latest --dry-run
```

## インストールせずに直接実行 (推奨)

常に最新版が走るので、アップデート作業は不要です。

```sh
# npm
npx -y git-harvest@latest

# pnpm
pnpx git-harvest@latest

# bun
bunx git-harvest@latest
```

### (任意) エイリアスを設定

```sh
# 通常 (デフォルト = merged のみ削除)
echo "alias ghv='npx -y git-harvest@latest'" >> ~/.zshrc
# 一掃 (--yolo = 未コミット・detached 含めて削除)
echo "alias 'ghv!'='npx -y git-harvest@latest --yolo'" >> ~/.zshrc
```

`git harvest`

```sh
# git サブコマンド — `git harvest` として実行 (インストール不要)
git config --global alias.harvest '!npx -y git-harvest@latest'
# または: git config --global alias.harvest '!pnpx git-harvest@latest'
# または: git config --global alias.harvest '!bunx git-harvest@latest'
```

## おすすめの運用法

Git hooks の post-merge コマンドと合わせると、merge や pull のたびに自動で収穫できます。

### [lefthook](https://github.com/evilmartians/lefthook) との連携

Git Hooks には husky / pre-commit / simple-git-hooks など色々ありますが、Lefthook は言語非依存で monorepo にも組み込みやすいのでおすすめです。`lefthook-local.yaml` を使えば、チーム開発で他メンバーに影響を与えず自分だけ実行する運用もできます。

```yaml
# lefthook-local.yaml
post-merge:
  commands:
    git-harvest:
      run: npx -y git-harvest@latest
      # or: pnpx git-harvest@latest
      # or: bunx git-harvest@latest
```

## 使い方

```sh
npx -y git-harvest@latest
```

### オプション

```
-h, --help                   ヘルプを表示
-v, --version                バージョンを表示
-n, --dry-run                削除せず、削除対象だけ表示

--committed[=<scope>]        閾値を committed へ (committed + merged を削除。未コミットは守る)
--files-changed[=<scope>]    閾値を files-changed へ (未コミット込みで削除。worktree 系のみ)
--untouched                  untouched な worktree も削除 (base と同一・作業なし)
--detached                   detached な worktree も削除 (branch 無し)
                             ⚠ detached worktree の commit は reflog のみで、削除すると恒久的に失われる
--yolo                       プリセット: --files-changed --committed --untouched --detached (全 scope)

logo                         ロゴを表示
```

`<scope>` は `worktree` / `claude-worktree` / `branch`。省略時は対象の全 scope に効きます。複数指定は comma 区切り (`--committed=worktree,branch`) か、フラグの繰り返しです。`--files-changed` は branch 段を持たないため worktree 系のみです。

## 動作内容

### ステージ (危険 → 安全)

git-harvest は各 worktree / branch を、含まれる「最も危険なステージ」で分類します。

```
files-changed   →   committed   →   merged
未コミット           コミット済        base に取り込み済
復旧不可             reflog で復旧可    完全に安全
```

フラグは閾値を下げ、そのステージと「それより安全な全部」を削除します。デフォルトは `merged` のみ削除 — 最も保守的で、post-merge hook でも安全です。

例: `--committed` は committed と merged を削除し、未コミットは守ります。`--files-changed` は未コミット込みで削除します。

### scope (削除対象の絞り込み)

| scope | 対象 |
|---|---|
| `worktree` | 通常パスの worktree (人が作った checkout) |
| `claude-worktree` | `.claude/worktrees/` 配下の worktree |
| `branch` | ブランチ |

閾値は scope ごとに保持されます。`--committed` は全 scope、`--committed=claude-worktree` はその scope だけに効きます。

### off-ladder (ステージの外・デフォルト保護)

| 状態 | 定義 | デフォルト | 削除 |
|---|---|---|---|
| `untouched` | clean かつ独自コミット無し (base と同一) | 保護 | `--untouched` / `--yolo` |
| `detached` | branch を持たない worktree (HEAD detached) | 保護 | `--detached` / `--yolo` |

branch の untouched は base と同一の残骸なので、worktree とは非対称にデフォルト削除します (worktree は「使う意図」で守り、branch は残骸として掃除する)。

> ⚠ detached worktree の commit は branch ref が無く、削除すると reflog のみ = `git gc` で恒久的に失われえます。`--detached` / `--yolo` のみが対象にします。

### ステータス表示

| マーカー | 意味 |
|---|---|
| `✓` | 削除済み |
| `→` | 削除予定 (dry-run) |
| `·` | 残す (右に理由) |

```
Worktrees
  ·  ~/.claude/worktrees/foo        untouched      base と同一・作業なし
  ·  ~/repo-hotfix                  detached       branch 無し
  ·  ~/.claude/worktrees/bar        committed      閾値 (merged) 未満で保護
  ✓  ~/.claude/worktrees/done                      削除 (merged)

Branches
  ·  feature/wip                    committed      閾値未満で保護
  ✓  feature/done                                  削除 (in-base)
```

残す理由は state ラベル (files-changed / committed / untouched / detached) か、invariant の理由です。

### invariant (どのフラグ・`--yolo` でも消えない絶対保護)

- メイン / デフォルトの worktree
- 現在の作業ディレクトリの worktree (`current`)
- locked な worktree (`git worktree lock`)
- 走行中の agent session を持つ worktree (`session running`)
- 現在 HEAD の branch (`current HEAD`)
- 生存している worktree が checkout 中の branch (`checked out`)

### Claude Code 連携

git-harvest は走行中の [Claude Code](https://claude.ai/code) セッションを検出し、その worktree を保護します。

| パス | 用途 |
|---|---|
| `~/.claude/sessions/<pid>.json` | 走行中セッションの検出 (`cwd` で worktree を一致確認 + `kill -0 pid` で生存確認) |

`.claude/worktrees/` 配下は `claude-worktree` scope として扱われ、通常の worktree と同じステージ閾値で判定されます (走行中セッションがあれば常に保護)。`--committed=claude-worktree` のように scope 指定で claude worktree だけ閾値を下げられます。

走行中セッションの判定は「ローカルに active な process があるか」(= `~/.claude/sessions/<pid>.json` が一致) だけを信号にします。Remote Control の iPhone 表示 (Connected / Disconnected / Archived) は区別しません。会話履歴 (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) は worktree を消しても残るため、`claude --resume <session-id>` で続きから再開できます。

テストや非標準インストール用にパスを上書きする env var:

| 環境変数 | デフォルト |
|---|---|
| `GIT_HARVEST_CLAUDE_SESSIONS_DIR` | `~/.claude/sessions` |
