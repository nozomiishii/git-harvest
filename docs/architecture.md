# アーキテクチャ

マージ済みブランチと worktree を整理する CLI。本番コードは `lib/*.ts`。
入口の `cli.ts` が parse → 検出 → 実行 → 出力 を上から順に呼ぶ一本道。

## 責務マップ

```
入口   cli.ts          argv parse → base 解決 → worktree→branch の順で起動 → 終了コード
         │
設定   flags-spec.ts   フラグの token / 効果 / help / --yolo 束（唯一の参照元）
       preset.ts       デフォルト Flags（保守的な初期値）
         │
検出   merge-detect.ts branch を untouched / merged / other に4段分類
       claude.ts       Claude 管理 worktree か・走行中 session かの保護判定
         │
実行   worktree.ts     worktree を 列挙→状態収集→削除判定→実削除→集約
       branch.ts       branch を 列挙→判定→削除→集約
         │
出力   format.ts       結果を着色済み文字列に整形（stdout 書き込みは cli）
       brand.ts        ブランドカラー・ロゴ定数

基盤   types.ts        Stage / Flags / SAFETY / ActionResult / CleanupDecision など共通の型と定数
       git.ts          git 実行ラッパー（throw 版 git / bool 版 gitExitOk / text 版 gitText）
```

## グループの役割

| グループ | ファイル | 役割 |
|---|---|---|
| 入口 | `cli.ts` | 背骨。argv を Flags + Mode に落とし、base を解決し、worktree→branch の順で cleanup を起動して終了コードを決める。help 全文もここ |
| 設定 | `flags-spec.ts` `preset.ts` | フラグ仕様をデータ駆動で一元定義。parse / help / preset がこの1配列を参照。`preset.ts` は初期値だけ |
| 検出・分類 | `merge-detect.ts` `claude.ts` | branch のマージ判定（4段フォールバック）と、worktree を消してよいかの保護条件を供給 |
| 実行 | `worktree.ts` `branch.ts` | リソースを列挙→判定→削除→集約。削除可否と保護理由は `decideWorktree` / `decideBranch` が `CleanupDecision` で1か所に返す（`shouldDelete*` はその真偽だけの薄い wrapper）。worktree と branch でほぼ同じ流れ |
| 出力 | `format.ts` `brand.ts` | `ActionResult` / `CleanupResult` を端末文字列へ。副作用のない純粋関数 |
| 基盤 | `types.ts` `git.ts` | 全体共通の型・定数と git 実行の低レベルラッパー。他の lib に依存しない葉 |

## データの流れ

`cli.main` が背骨で、上から下へ一方向に呼ぶ。

- `parseArgs` が argv を `Flags` + Mode にする
- `resolveBase` が base ブランチを決める
- `cleanupWorktrees` → `cleanupBranches` の順で各リソースを処理する
- 各 cleanup は内部で「列挙 → 状態収集 → 削除判定（`decide*` が `CleanupDecision` を返す）→ 実削除 → `ActionResult` に集約」を回す
- 削除判定は `merge-detect`（branch のマージ）と `claude`（worktree の保護）に問い合わせる
- 集約結果を `format` が文字列にし、`cli` が stdout へ書く

## 削除判定の核

`Stage` は `files-changed → committed → merged` の3段 ladder。`types.ts` の `SAFETY` が危険→安全の順で並ぶ。

フラグは「どの stage まで消すか」の閾値であって、分岐ロジックではない。
`flags-spec` の `applyToken` が複数フラグを常に危険側へ畳み、`atOrSafer` が「閾値以上か」を index 比較で判定する。

branch のマージ検出は4段フォールバック（first-parent → ancestor → 仮想 squash → cherry-pick）。詳細は `merge-detect.ts` の `classifyBranch`。
