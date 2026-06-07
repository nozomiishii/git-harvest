# git-harvest フラグ設計（簡素化版）

[#169](https://github.com/nozomiishii/git-harvest/issues/169) の 9 フラグ設計を簡素化した確定案。
scope を flag 名から外して「値」にし、肯定形命名を保ったまま surface を縮小する。

## 狙い

- scope×stage の grid で増えたフラグ（#169 で実質 9 個）を、stage を token・scope を任意引数にして畳む
- 肯定形命名（[dotfiles#1068](https://github.com/nozomiishii/dotfiles/issues/1068)）を維持
- codex 等のツール追加を「フラグ追加ゼロ」で吸収できる構造にする
- default はこれまで通り保守的（merged のみ・完全復旧可）で post-merge hook に安全

## モデル

### stage（内部 3 段・復旧リスク順）

```
files-changed   →   committed   →   merged
(未コミット)        (コミット済)     (base に取り込み済)
復旧不可            reflog 復旧可    完全に安全
```

worktree の現在地 = 含まれる最も危険な stage（未コミットがあれば必ず files-changed）。
この 3 段は内部分類として保持する（後述のとおり token は 2 つに減らすが、stage 自体は 3 段のまま）。

### scope（per-tool・値として扱う）

| scope | 対象 |
|---|---|
| `worktree` | 通常 path の worktree（人間が作った checkout） |
| `claude-worktree` | `.claude/worktrees/` 配下 |
| `codex-worktree` | codex の worktree path 配下（将来。path 規約は実装時に確定） |
| `branch` | ブランチ |

閾値は `Record<Scope, Stage>` で持ち、default は全 scope `merged`。
path→scope は順序付き matcher（claude path → codex path → … → 通常）で 1 worktree を 1 scope に分類する。
ツール追加 = SCOPES に値 1 個 ＋ path matcher 1 行 ＋ running-session 検出 1 個。フラグは増えない。

### off-ladder（ladder の外・default 保護）

| 状態 | 定義 | default | 削除 |
|---|---|---|---|
| `untouched` | clean かつ独自コミット無し（base と同一） | 保護 | `--untouched` または `--yolo` |
| `detached` | branch を持たない worktree（HEAD detached） | 保護 | `--detached` または `--yolo` |

`--untouched` / `--detached` は path 非依存の boolean。ladder の閾値とは独立した toggle で、その状態の worktree だけを消す。
branch の `untouched` は base と同一の ref なので `merged` に畳んで default 削除（worktree=使う intent で守る / branch=残骸ラベルで掃除、の非対称は意図）。
detached は branch ref が無く、消すと commit が reflog のみ → gc で恒久喪失しうる。本案は warn-only:
salvage branch の自動生成は採らず、恒久喪失の警告を `--detached` と `--yolo` の help に 1 行出す（専用フラグがあるので警告が名指しの surface を持てる）。

## 出力（status ラベル）

state ラベル（files-changed / committed / merged / untouched / detached）は、フラグ名と出力ラベルの両方で同じ語彙を使う。
保護された worktree / branch は「残した理由」付きで表示され、その reason 列が state ラベルそのもの。
[dotfiles#1068](https://github.com/nozomiishii/dotfiles/issues/1068) が命名対象とした「状態ラベル」はここを指す。

```
Worktrees
  ·  .claude/worktrees/foo-x      untouched     保護（base と同一・独自コミット無し）
  ·  ../hotfix-wt                 detached      保護（branch 無し）
  ·  .claude/worktrees/bar-y      committed     保護（閾値 merged 未満）
  ✓  .claude/worktrees/done-z                   削除（merged）
```

- `·  <path>  <reason>` = 保護。reason は state ラベル（files-changed / committed / untouched / detached）か invariant 理由（locked / session running / current / checked out）
- `✓  <path>` = 削除済み　／　`→  <path>` = dry-run の削除予定

フラグ（`--committed` 等）は「どの state を削除するか」を選び、出力ラベルは「各 worktree が今どの state か」を見せる。命名した語はフラグ名と出力ラベルの両方で効く。

## フラグ surface

| token | 効果 | scope |
|---|---|---|
| `--committed[=<scope>]` | 閾値を committed へ（committed＋merged 削除、未コミットは守る）。cumulative | 全 scope。省略=全部 |
| `--files-changed[=<scope>]` | 閾値を files-changed へ（未コミット込みで削除）。cumulative | `worktree` 系のみ（branch 不可）。省略=全部 |
| `--untouched` | untouched worktree も削除（zero-loss・off-ladder toggle） | path 非依存 |
| `--detached` | detached worktree も削除（off-ladder toggle・恒久喪失の警告付き） | path 非依存 |
| `--yolo` | preset。`--files-changed --committed --untouched --detached`（全 scope）の束 | — |
| `-n, --dry-run` | 削除せず予測のみ | — |
| `-h, --help` / `-v, --version` | help / version | — |
| `logo` | ロゴ表示（subcommand） | — |

ルール:

- 省略フラグ = その stage を持つ全 scope に効く。`--committed`=worktree＋claude-worktree＋branch、`--files-changed`=worktree 系のみ（branch は files-changed 段を持たない）
- 複数 scope は comma（`--files-changed=worktree,claude-worktree`）または繰り返し（`--files-changed=worktree --files-changed=claude-worktree`）
- `--yolo` ＝ `--files-changed --committed --untouched --detached`（全 scope）の正確な束。preset の挙動は全て個別フラグで表現でき、暗黙の preset 外挙動を持たない

### #169 からの移行

| 旧（#169・9 フラグ） | 新 |
|---|---|
| `--worktree-files-changed` | `--files-changed=worktree` |
| `--claude-worktree-files-changed` | `--files-changed=claude-worktree` |
| `--worktree-committed` | `--committed=worktree` |
| `--claude-worktree-committed` | `--committed=claude-worktree` |
| `--branch-committed` | `--committed=branch` |
| `--worktree-detached` / `--claude-worktree-detached` | `--detached`（path 非依存に統合） |
| `--worktree-untouched` / `--claude-worktree-untouched` | `--untouched`（path 非依存に統合） |

「両 worktree を未コミット込みで一掃 ＋ branch も committed まで」= `--files-changed --committed=branch`（2 token）。

## 判定ロジック（pseudo）

```ts
const SCOPES = ["worktree", "claude-worktree", "branch"] as const  // codex-worktree は将来 1 行追加
const SAFETY = ["files-changed", "committed", "merged"] as const  // 危険 → 安全

type Flags = {
  thresholds: Record<Scope, Stage>  // default 全 "merged"
  untouched: boolean                // off-ladder toggle, default false
  detached: boolean                 // off-ladder toggle, default false
  dryRun: boolean
}

function scopeOf(wt): Scope {
  if (matchClaudeWorktree(wt.path)) return "claude-worktree"
  // codex-worktree は将来: matchCodexWorktree を 1 行追加
  return "worktree"
}

function worktreeStage(wt): Stage {
  if (wt.hasUncommittedChanges) return "files-changed"
  if (wt.branch.isMerged)       return "merged"
  return "committed"
}

function shouldDeleteWorktree(wt, flags): boolean {
  if (isInvariant(wt)) return false            // 後述の絶対保護
  if (!wt.branch)      return flags.detached   // detached: --detached / --yolo
  if (wt.isUntouched)  return flags.untouched  // untouched: --untouched / --yolo
  const threshold = flags.thresholds[scopeOf(wt)]
  return SAFETY.indexOf(worktreeStage(wt)) >= SAFETY.indexOf(threshold)
}

// --yolo はパース時に展開: 全 threshold を最危険へ + untouched = detached = true。
// preset = 個別フラグの束なので、判定ロジックに yolo 分岐は無い。

function shouldDeleteBranch(b, flags): boolean {
  if (isInvariantBranch(b)) return false
  const stage = (b.isMerged || b.isUntouched) ? "merged" : "committed"  // untouched は merged に畳む
  return SAFETY.indexOf(stage) >= SAFETY.indexOf(flags.thresholds.branch)
}
// 実行順: worktree cleanup → 生存 worktree 集合で branch cleanup
```

## invariant（どのフラグ・`--yolo` でも消えない絶対保護）

worktree:

- main / default-branch の worktree
- カレント worktree（cwd が属する worktree）
- locked worktree（`git worktree lock`）
- 走行中 agent session のある worktree（ツールごとに検出: claude=`~/.claude/sessions/<pid>.json`、codex=codex の方式・実装時に確定）

branch:

- 現在 HEAD（git が拒否）
- 生存 worktree が参照中の branch（git が拒否）

検出は内部に持つが、解除フラグは user に晒さない（消すなら `git worktree unlock` / session 終了 / HEAD 切替）。
base（default branch）解決は #169/#180 の fail-closed 方針を踏襲（origin/HEAD → set-head --auto → 失敗なら error exit、main/master へ自動 fallback しない）。

## 命名根拠

### stage / scope

肯定形の過去分詞（files-changed / committed / merged）で進行モデルと対応。help 冒頭に progression を明示（後述）。
scope 名（worktree / claude-worktree / branch）は資源セレクタなので肯定形ルールの対象外。

### untouched 据え置き

`untouched` は `un-` 形だが、off-ladder の intrinsic かつ binary な状態なので [dotfiles#1068](https://github.com/nozomiishii/dotfiles/issues/1068) の肯定形ルール（progression/scalar 段階ラベルに限定）の射程外。
多角調査（5 観点会議＋敵対レビュー）でも `untouched` が最良: intrinsic・初心者即読・git 既存語と衝突なし・just-created も reset-to-base も両対応。
肯定の候補（fresh / created / empty 等）は全て age 誤記述・git 衝突・無損失状態の取りこぼし等で破綻。`untouched` は off-ladder の相棒 `detached` と同じ「不在」系の語として並ぶ。
この語は出力の status ラベルと `--untouched` フラグ名の両方で使い、state 語彙を一本化する（`--untouched` は否定の `--no-X` ではなく「untouched 状態を選ぶ」肯定形 selector なので Cobra の肯定形ルールにも反しない）。

### 公開ガイドラインとの整合

- 肯定形 flag を明文化したのは実質 [Cobra](https://cobra.dev/docs/how-to-guides/working-with-flags/) のみ。否定が要るときの総意は「root は肯定・否定は派生 1 段」（argparse / Abseil / Git）
- `--committed=<scope>` は [Azure CLI](https://github.com/Azure/azure-cli/blob/dev/doc/command_guidelines.md)「同じ物の別取り方を複数 flag にするな→1 つの記述的 flag」、kubectl「実 enum 値を取る」、Git `--color[=<when>]` 同形、clig.dev「`none` センチネル」が裏付け
- 注意: 厳密 POSIX Guideline 7 は optional option-argument を非推奨。`--committed[=...]` は POSIX 純度とは緊張するが GNU getopt_long と上記ベンダーは許容（実害なし）
- 状態ラベルの命名極性ルールはどの組織も未公開（gap）。詳細は dotfiles の調査 issue 参照

## help text 案

```
git-harvest cleans up worktrees and branches based on commit lifecycle stage.

Stages (risky -> safe):
  files-changed  ->  committed  ->  merged

  A worktree/branch is classified by its most at-risk stage (uncommitted changes win).
  A flag lowers the threshold and deletes that stage and everything safer; merged is the safe default.
  "untouched" (no work, identical to base) and "detached" (no branch) sit off this ladder:
  kept by default, removed by --untouched / --detached (or --yolo).

Usage: git-harvest [options]
       git-harvest logo

Options:
  -h, --help                  Show this help
  -v, --version               Show version
  -n, --dry-run               Show what would be deleted without deleting

  --committed[=<scope>]       Delete from committed (committed + merged). scope: worktree,
                              claude-worktree, branch (default: all).
  --files-changed[=<scope>]   Delete from files-changed (uncommitted included). scope: worktree,
                              claude-worktree (default: all worktree scopes).
                              Multiple scopes: comma-separated or repeat the flag.
  --untouched                 Delete untouched worktrees (no work, identical to base; off-ladder).
  --detached                  Delete detached worktrees (no branch; off-ladder).
                              WARNING: a detached worktree's commits are unreachable -- removal can
                              lose them permanently (no reflog recovery).

  --yolo                      Preset: --files-changed --committed --untouched --detached (all scopes).
                              WARNING: removes uncommitted changes and detached commits (see --detached).

Subcommands:
  logo                        Show the git-harvest logo

Invariants are always protected (no flag or --yolo can override):
  main/default worktree, current cwd worktree, locked worktree, worktree with a running agent session,
  current HEAD branch, branch checked out in a surviving worktree.
```

## 実装メモ

- 閾値は `Record<Scope, Stage>` で保持（明示フィールドにしない）。scope 追加が型・初期化・判定を触らず「データ」で済む
- `--committed[=<scope>]` パースは `arg.split("=", 2)`。`=` 無し=全 applicable scope、空値（`--committed=`）は error、comma=`value.split(",")`
- codex 対応の本体は scope 分割ではなく path matcher ＋ running-session 検出（どの設計でも必須）。これが書けるまで「codex 対応」と言わない
- off-ladder は `untouched` / `detached` の boolean 2 つ。`--yolo` はパース時にこれらを true にし全 threshold を最危険へ展開する（preset = フラグの束、判定に yolo 分岐を作らない）

## 保留 / 今後（非破壊で追加可能）

- pushed 軸: 今回スコープ外（committed に吸収）。必要が実証されたら committed と merged の間に肯定形で 1 段追加
- detached の salvage branch 自動生成: 今回は warn-only を採用。foolproof を強めたくなったら後付け
- 中間 preset / scope group（例 agent worktree 一括）: 必要が出たら非破壊で追加

## 実装

実装計画: [docs/flag-redesign-plan.md](./flag-redesign-plan.md)
