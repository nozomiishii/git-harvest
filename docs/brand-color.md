# ブランドカラー

`#C0FF39` — Inabikari（rgb 192, 255, 57）

「稲光」: 古くから「雷光が稲を実らせる（稲の成長を促す）」と信じられていたことに由来しており、「稲妻」とほぼ同じ意味

- C = Crop（branch も worktree も harvest 対象）
- 0 → FF = 育ち始めから育ちきるまでな感じ
- 39 = サンクス！収穫！

コード内では「稲光」や「Inabikari」の名前は使わず `BRAND_COLOR` / `ブランドカラー` にする。

## 配色

| 色 | 使う場所 |
| --- | --- |
| ブランドカラー | wordmark `git harvest`、`✓` 成功マーカー、`→` will-delete マーカー、`logo` subcommand |
| dim gray | `·` 削除せず保護、reason 文 |
| terminal default red | エラー |

エラーだけ terminal default red のままにするのは、CLI 規約（red=error / yellow=warn）と衝突させないため。

dark terminal 前提で、light terminal での視認性は犠牲にする（ごめん）。`#C0FF39` は L≈0.83 なので白背景では飛ぶ。

`NO_COLOR=1` と 非 TTY ではプレーンテキストに fallback する。
