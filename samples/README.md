# Minimal standalone shell samples

git-harvest の `default` と `--yolo` の「削除挙動だけ」を切り出した、単体で動く shell スクリプトです。

## 目的

個人ライブラリ（git-harvest）に依存しづらい環境（会社など）でも、同じ掃除をしたいときに 1 ファイルをコピペして使えるリファレンス。本リポジトリにマージはせず、参照用の記録として残しています（この PR は close 済み）。

## 中身

| file | 役割 | 行数（実測） |
|---|---|---|
| `git-harvest-default.sh` | merge済 worktree（clean）と base にある branch だけ削除 | 115 行（実質 79 行） |
| `git-harvest-yolo.sh` | invariant 以外を全削除（未コミット込み、force） | 76 行（実質 55 行） |

どちらも throwaway repo で動作確認済み。

## 挙動

`git-harvest-default.sh`（保守的）:

- worktree: merge済 かつ clean なものだけ削除
- branch: 独自コミットが base にある（merge済 / 独自コミットなし）ものを削除
- 保護: main/default worktree・カレント worktree(cwd)・locked・走行中 Claude session・base branch・現在 HEAD・生存 worktree が checkout 中の branch・untouched worktree（未着手の checkout は残す）

`git-harvest-yolo.sh`（危険）:

- worktree: invariant（main/default・カレント cwd・locked・session）以外を未コミット込みで force 削除
- branch: base・現在 HEAD・生存 worktree が参照中 以外を `-D` 削除
- 未コミット変更も未マージ commit も確認なしで消える。実行前に対象をよく確認すること

base（default branch）は `origin/HEAD` から fail-closed で解決（取れなければ何もせず exit）。`GIT_HARVEST_CLAUDE_SESSIONS_DIR` で session ディレクトリを上書き可能。

## 含まないもの

削除コアのみ。本家 git-harvest にある dry-run / 色・bold / `--help` / `logo` / 個別 flag 体系（`--worktree-detached` 等）/ 1件ずつ隔離した fail-safe 削除 / サマリー表示 / `fetch --prune` 後処理 は載せていません。これらを足すと容易に倍以上の規模になります。

## アイデア（未実装）

`git harvest eject --yolo` のように、本体から「その preset 相当の単体スクリプト」を吐き出せると、こういうコピペ用ファイルを手で保守せずに済むかもしれません。参考まで。
