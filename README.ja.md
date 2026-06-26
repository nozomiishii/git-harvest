# git-harvest

[English](./README.md) | 日本語

<p>
  <a href="https://www.npmjs.com/package/git-harvest"><img src="https://img.shields.io/npm/v/git-harvest.svg" alt="npm version" /></a>
</p>

branch と worktree の片付けツール

## お試し

何が消えるか確認:

```sh
npx -y git-harvest@latest --dry-run
```

```
Worktrees
  ·  ~/.claude/worktrees/foo   untouched   base と同一・作業なし
  →  ~/.claude/worktrees/done

Branches
  ·  feature/wip               committed   閾値未満で保護
  →  feature/done
```

## セットアップ (任意)

`npx -y git-harvest@latest` だけでも動きますが、alias を登録すると短く呼べます。常に最新版が走るので、アップデートも不要です。

Git alias — `git harvest` として呼ぶ:

```sh
git config --global alias.harvest '!npx -y git-harvest@latest'
# または: git config --global alias.harvest '!pnpx git-harvest@latest'
# または: git config --global alias.harvest '!bunx git-harvest@latest'
```

Shell alias — `.bashrc` / `.zshrc` に追加:

```sh
alias ghv='npx -y git-harvest@latest'
```

## 使い方

```sh
# merged な branch を削除 (デフォルト・最も安全。post-merge hook でも安全)
git harvest

# まだチェックアウトして作業なしの worktree も削除
git harvest --untouched

# 編集済みファイルの作業がある worktree も削除
git harvest --files-changed

#　コミット済みの作業がある worktree も削除
git harvest --committed
```

フラグは自由に組み合わせられます。`git harvest --committed --untouched` は committed な branch と untouched な worktree をまとめて削除します。

全部消したいとき:

```sh
# --files-changed --committed --untouched --detached と等価
git harvest --yolo
```

`--committed` は scope で対象を絞れます (`=worktree` / `=claude-worktree` / `=codex-worktree` / `=branch`)。`--files-changed` は worktree scope のみ (`=worktree` / `=claude-worktree` / `=codex-worktree`)。詳しくは scope セクション参照。

## 自動化 (任意)

`git harvest` を post-merge hook に設定すれば、merge や pull のたびに自動実行されます。

### [lefthook](https://github.com/evilmartians/lefthook) との連携

Lefthook は言語非依存で monorepo 向き。`lefthook-local.yaml` を使えば、他メンバーに影響を与えず自分だけ実行する運用もできます。

```yaml
# lefthook-local.yaml
post-merge:
  commands:
    git-harvest:
      run: npx -y git-harvest@latest
      # or: pnpx git-harvest@latest
      # or: bunx git-harvest@latest
```

## 動作内容

branch はこの順に状態が進みます:

```
未着手 (untouched)
  ↓
ファイル変更済  →  commit済  →  merge済
(files-changed)   (committed)  (merged)
  ↑
  └─ 編集すると、どの状態からでも ファイル変更済 へ戻る
```

フラグごとの削除対象は次の表のとおりです (✓ = 削除対象):

| stage | 削除リスク | フラグなし | `--committed` | `--files-changed` |
| --- | --- | --- | --- | --- |
| files-changed | 失えば復旧不可 | · | · | ✓ |
| committed | reflog で復旧 (面倒) | · | ✓ | ✓ |
| merged | 完全に安全 | ✓ | ✓ | ✓ |

デフォルトは `merged` のみ削除 — 最も保守的で、post-merge hook でも安全です。

### scope (削除対象の絞り込み)

| scope | 対象 |
|---|---|
| `worktree` | 通常パスの worktree |
| `claude-worktree` | `.claude/worktrees/` 配下の worktree |
| `codex-worktree` | `$CODEX_HOME/worktrees` 配下の worktree |
| `branch` | ブランチ |

閾値は scope ごとに保持されます。`--committed` は全 scope、`--committed=claude-worktree` はその scope だけに効きます。複数指定は comma 区切り (`--committed=worktree,branch`) か、フラグの繰り返しです。

### 通常は保護される特殊な状態

| 状態 | 定義 | デフォルト | 削除 |
|---|---|---|---|
| `untouched` | clean かつ独自コミット無し (base と同一) | 保護 | `--untouched` |
| `detached` | branch を持たない worktree (HEAD detached) | 保護 | `--detached` |

untouched な branch は base と同一の ref でしかないため、デフォルトで削除されます。worktree は作業の意図を示すので保護し、branch は残骸として消す — 意図的な非対称です。

> ⚠ detached worktree の commit は branch ref が無く、worktree 削除でその reflog も一緒に消えるため恒久的に失われます (reflog でも復旧不可)。

### ステータス表示

| マーカー | 意味 |
|---|---|
| `✓` | 削除済み |
| `→` | 削除予定 (dry-run) |
| `·` | 残す (右に理由) |
| `✗` | 削除失敗 |

```
Worktrees
  ·  ~/.claude/worktrees/foo        untouched      base と同一・作業なし
  ·  ~/repo-hotfix                  detached       branch 無し
  ·  ~/.claude/worktrees/bar        committed      閾値 (merged) 未満で保護
  ✓  ~/.claude/worktrees/done

Branches
  ·  feature/wip                    committed      閾値未満で保護
  ✓  feature/done
```

### どのフラグでも消えない絶対保護の状態

- メイン / デフォルトの worktree
- base branch を checkout している worktree (`base branch`)
- 現在の作業ディレクトリの worktree (`current`)
- locked な worktree (`git worktree lock`)
- 実行中の agent session を持つ worktree (`session running`)
- 現在 HEAD の branch (`current HEAD`)
- 生存している worktree が checkout 中の branch (`checked out`)

### worktree の判定フロー

フラグなし (デフォルト = 全 scope の閾値 merged) の判定木です。フラグは閾値を下げて keep → delete を切り替えるので、各 keep ノードに「どのフラグなら消えるか」を併記しています。invariant はフラグでは動かせない絶対保護です。

```mermaid
flowchart TD
    Start([worktree を判定]) --> Main{"メイン / デフォルトの<br/>worktree?"}
    Main -->|はい| KeepMain[残す<br/>表示しない]
    Main -->|いいえ| Current{"現在の作業ディレクトリの<br/>worktree?"}
    Current -->|はい| KeepCurrent["·  current"]
    Current -->|いいえ| Base{"base branch を<br/>checkout 中?"}
    Base -->|はい| KeepBase["·  base branch"]
    Base -->|いいえ| Locked{"git worktree lock<br/>されている?"}
    Locked -->|はい| KeepLocked["·  locked"]
    Locked -->|いいえ| Running{"実行中の<br/>agent session がある?"}
    Running -->|はい| KeepRunning["·  session running"]
    Running -->|いいえ| Detached{"detached?<br/>(branch 無し)"}
    Detached -->|はい| KeepDetached["·  detached<br/>削除: --detached / --yolo"]
    Detached -->|いいえ| Files{"未コミットの<br/>変更がある?"}
    Files -->|はい| KeepFiles["·  files-changed<br/>削除: --files-changed / --yolo"]
    Files -->|いいえ| Untouched{"untouched?<br/>独自コミット無し + clean"}
    Untouched -->|はい| KeepUntouched["·  untouched<br/>削除: --untouched / --yolo"]
    Untouched -->|いいえ| Merged{"merged?"}
    Merged -->|いいえ| KeepCommitted["·  committed<br/>削除: --committed / --yolo"]
    Merged -->|はい| DeleteMerged["✓  削除<br/>(merged = デフォルト)"]
    classDef keep fill:#f5f5f5,stroke:#9e9e9e,color:#424242
    classDef delete fill:#eeffc4,stroke:#C0FF39,color:#000
    class KeepMain,KeepCurrent,KeepBase,KeepLocked,KeepRunning,KeepDetached,KeepUntouched,KeepFiles,KeepCommitted keep
    class DeleteMerged delete
```

branch 側も同じ考え方で、current HEAD → checked out → 分類の順に判定し、デフォルトでは base に取り込み済み (in-base) のみ削除します。

### Claude Code の worktrees

git-harvest は実行中の [Claude Code](https://claude.ai/code) セッションを検出し、その worktree を保護します。

| パス | 用途 |
|---|---|
| `~/.claude/sessions/<pid>.json` | 実行中セッションの検出 (`cwd` で worktree を一致確認 + `kill -0 pid` で生存確認) |

`.claude/worktrees/` 配下は `claude-worktree` scope として扱われ、通常の worktree と同じステージ閾値で判定されます (実行中セッションがあれば常に保護)。`--committed=claude-worktree` のように scope 指定で claude worktree だけ削除対象にもできます。

実行中セッションの判定は「ローカルに active な process があるか」(= `~/.claude/sessions/<pid>.json` が一致) だけを判定にします。Remote Control の iPhone 表示 (Connected / Disconnected / Archived) は区別しません。会話履歴 (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`) は worktree を消しても残るため、`claude --resume <session-id>` で続きから再開できます。

### Codex app の worktrees

Codex app が管理する worktree は `$CODEX_HOME/worktrees` (通常は `~/.codex/worktrees`) 配下に作られます。その worktree は `codex-worktree` scope として扱われ、通常の worktree と同じステージ閾値で判定されます。`--committed=codex-worktree` のように scope 指定で Codex worktree だけ削除対象にもできます。

Codex のスレッド管理 DB (`$CODEX_HOME/state_*.sqlite`) で active（未アーカイブ）な user thread の cwd がこの worktree 配下の場合、`session running` として保護します。DB が無い・読めない場合は通常のステージ判定に戻ります。

