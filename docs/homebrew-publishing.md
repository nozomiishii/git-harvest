# Homebrew Publishing Guide

CLI ツールを Homebrew で公開するためのガイド。
shell スクリプトを個人 Tap で配布し、CI で自動更新するまでの流れをまとめる。

## Homebrew の基本構造

### Formula

インストール手順を記述した Ruby ファイル。「どこからダウンロードし、何を bin に配置するか」を定義する。

```ruby
class GitHarvest < Formula
  desc "Clean up merged branches and worktrees (supports squash merges)"
  homepage "https://github.com/nozomiishii/git-harvest"
  url "https://github.com/nozomiishii/git-harvest/archive/refs/tags/v0.1.4.tar.gz"
  sha256 "ebbac474c06f569b94ea54adb2914410d94274d00222fa887ead772a605e1c0c"
  license "MIT"

  def install
    bin.install "lib/git-harvest"
  end

  test do
    assert_match "git-harvest v#{version}", shell_output("#{bin}/git-harvest --version")
  end
end
```

各フィールドの役割:

| フィールド | 説明 |
|---|---|
| `url` | GitHub がタグごとに自動生成するソース tarball の URL。`/archive/refs/tags/` を使用 |
| `sha256` | tarball の SHA-256 ハッシュ値。改ざん防止の検証に使う |
| `bin.install` | tarball 展開後に指定ファイルを Homebrew の bin ディレクトリにコピー。実行権限も保持される |
| `test` | `brew test <formula>` 実行時の動作確認 |

> `depends_on "git"` は不要。Homebrew 自体が git に依存しているため冗長になる。

SHA256 の計算:

```bash
curl -sL https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz | shasum -a 256
```

### Tap

Formula を格納する Git リポジトリ。`homebrew-xxx` という命名規則で、`brew install user/xxx/tool` でアクセスされる。

```
brew tap nozomiishii/tap
  → 内部で git clone https://github.com/nozomiishii/homebrew-tap.git
```

`homebrew-` プレフィックスがリポジトリ名に**必須**。これがないと `brew tap` で認識されない。

### homebrew-core vs 個人 Tap

| | homebrew-core | 個人 Tap |
|---|---|---|
| 審査 | 必要（スター数・利用実績が求められる） | 不要 |
| `brew install` | `brew install git-harvest` | `brew install nozomiishii/tap/git-harvest` |
| 管理 | Homebrew チーム | 自分 |
| 適用場面 | 広く使われているツール | 個人・小規模プロジェクト |

## リポジトリ命名パターン

### パターン A: `homebrew-tap` に集約

複数ツールの Formula を 1 つのリポジトリにまとめる。

```
nozomiishii/homebrew-tap
  └── Formula/
        ├── git-harvest.rb
        └── future-tool.rb
```

```bash
brew install nozomiishii/tap/git-harvest
brew install nozomiishii/tap/future-tool
```

採用例:

| オーナー | 代表ツール | Tap |
|---|---|---|
| nektos | act (69k stars) | [homebrew-tap](https://github.com/nektos/homebrew-tap) |
| charmbracelet | glow (24k), vhs (19k), gum (19k) | [homebrew-tap](https://github.com/charmbracelet/homebrew-tap) |
| goreleaser | goreleaser (16k) | [homebrew-tap](https://github.com/goreleaser/homebrew-tap) |
| muesli | duf (15k) | [homebrew-tap](https://github.com/muesli/homebrew-tap) |
| steipete | 21 個のツールを集約 | [homebrew-tap](https://github.com/steipete/homebrew-tap) |

### パターン B: `homebrew-<tool>` で個別作成

ツールごとにリポジトリを作る。

```
nozomiishii/homebrew-git-harvest
  └── Formula/
        └── git-harvest.rb
```

```bash
brew install nozomiishii/git-harvest/git-harvest
```

採用例:

| オーナー | ツール | Tap |
|---|---|---|
| jesseduffield | lazygit (75k) | [homebrew-lazygit](https://github.com/jesseduffield/homebrew-lazygit) |
| derailed | k9s (33k) | [homebrew-k9s](https://github.com/derailed/homebrew-k9s) |
| wagoodman | dive (54k) | [homebrew-dive](https://github.com/wagoodman/homebrew-dive) |

### どちらを選ぶべきか

| 条件 | 推奨 |
|---|---|
| ツールが 1〜2 個で増える予定がない | どちらでも OK |
| 今後ツールを増やす予定がある | **パターン A（集約型）** |
| 既存リポジトリ名を `homebrew-*` に変えたくない | **パターン A** 一択 |

git-harvest は既存リポジトリ名を変更せず、今後のツール追加も想定しているため**パターン A** を採用。

## 公開の流れ

### 1. homebrew-tap リポジトリの作成

```bash
gh repo create nozomiishii/homebrew-tap --public --description "Homebrew formulae"
```

### 2. Formula ファイルの作成

SHA256 を計算:

```bash
curl -sL https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.tar.gz | shasum -a 256
```

`Formula/<tool>.rb` を作成（内容は「Homebrew の基本構造 > Formula」セクションを参照）。

> ステップ 1〜2 は `gh api` で自動化可能。手動でやる必要はない。

### 3. インストール確認（手動）

```bash
brew tap <owner>/tap
brew install <tool>
<tool> --version
```

### 4. brew audit による品質チェック（手動）

```bash
brew audit --new <owner>/tap/<tool>
```

Formula が Homebrew のガイドラインに沿っているかを検証するコマンド。以下をチェックする:

- `desc` が適切か（長すぎない、冗長な書き出しでない）
- `url` が有効か
- `sha256` が正しいか
- `license` が正しいか
- `test` ブロックが存在するか
- Ruby の構文エラーがないか

`--new` を付けると新規 Formula 向けの追加チェック（より厳しい基準）が適用される。
homebrew-core に PR を出す場合は必須だが、個人 tap では参考程度。
問題がなければ何も出力されない。

> ステップ 3〜4 はローカルに Homebrew が必要なため手動で実施する。

## 他のインストール方法との共存

curl と Homebrew の両方でインストールすると、バイナリが 2 箇所に存在する:

| 方法 | 配置場所 |
|---|---|
| curl (`install.sh`) | `~/.local/bin/git-harvest` |
| Homebrew | `/opt/homebrew/bin/git-harvest`（Apple Silicon） |

`install.sh` は `.zshrc` に `export PATH="${XDG_BIN_HOME:-$HOME/.local/bin}:$PATH"` を追加するため、
`~/.local/bin` が `$PATH` の先頭に来る。つまり **curl 版が常に優先される**。

Homebrew に一本化する場合は、先に curl 版をアンインストールする:

```bash
curl -fsSL https://raw.githubusercontent.com/nozomiishii/git-harvest/main/uninstall.sh | bash
```

## CI による自動更新

リリース頻度が上がって手動更新が面倒になったら、CI で Formula の自動更新を組む。

### Formula 自動更新ツールの比較

Formula の `url` / `sha256` を自動更新する方法はいくつかある:

| ツール | 仕組み | Homebrew 必要 | SHA256 | 用途 |
|---|---|---|---|---|
| **[mislav/bump-homebrew-formula-action](https://github.com/mislav/bump-homebrew-formula-action)** | GitHub API のみで formula を編集 | 不要 | 自動計算 | **個人 tap（推奨）** |
| [dawidd6/action-homebrew-bump-formula](https://github.com/dawidd6/action-homebrew-bump-formula) | `brew bump-formula-pr` のラッパー | 必要 | 自動計算 | homebrew-core への PR |
| [Justintime50/homebrew-releaser](https://github.com/Justintime50/homebrew-releaser) | Formula をゼロから再生成 | Docker ベース | 自動 | マルチアーキバイナリ |
| [GoReleaser](https://goreleaser.com/customization/homebrew_formulas/) (`brews` section) | ビルド・リリース・formula を一括管理 | 不要 | 自動計算 | Go プロジェクト |
| 直書き (sed + git push) | clone → sed → push | 不要 | 手動計算 | フルコントロールが必要な場合 |

> charmbracelet (glow, vhs, gum) や nektos (act) は Go プロジェクトのため GoReleaser を使用。
> 非 Go プロジェクトでは mislav/bump-homebrew-formula-action が最も使われている。

#### mislav/bump-homebrew-formula-action を採用する理由

**作者**: [Mislav Marohnić](https://github.com/mislav) — GitHub CLI (`gh`) のリードエンジニア。GitHub CLI の前身である [hub](https://github.com/mislav/hub) (22.9k stars) を 10 年間メンテナンスし、その実績から GitHub に採用され CLI チームを率いた人物。[rbenv](https://github.com/rbenv/rbenv) (16.7k stars) の主要メンテナーでもある。

- **GitHub API のみで動作**: Homebrew のインストールも tap リポジトリの clone も不要。軽量で高速
- **SHA256 を自動計算**: tarball のダウンロードとハッシュ計算をアクション内部で実行。HTTP エラー時は自動で失敗する
- **積極的にメンテナンス**: v4.1 (2026-03-23) と直近でリリース済み
- **sed による置換が不要**: `url`, `sha256`, `version` フィールドを安全に更新

### 認証方式の比較

CI からクロスリポジトリ（git-harvest → homebrew-tap）に push するための認証方式:

| 方式 | 有効期限 | セキュリティ | セットアップ | 1Password 連携 |
|---|---|---|---|---|
| PAT (Fine-grained) | 最大 1 年（要ローテーション） | 中（個人アカウント紐付き） | 簡単 | 可 |
| Deploy Key (SSH) | なし（1 年未使用で自動削除） | 中（git push のみ） | 簡単 | 可 |
| **GitHub App** | **なし**（秘密鍵は無期限） | **高**（最小権限、短命トークン） | やや手間（初回のみ） | **可** |

**推奨: GitHub App + 1Password**

理由:
- 秘密鍵に有効期限がなく、ローテーション不要
- 実際の操作に使う Installation Token は 1 時間で自動失効するため安全
- App に付与した権限（Contents: Write）のみが操作可能。PAT と違い個人アカウント全体がリスクにならない
- 1 つの App で複数ツールの Formula 更新に使い回せる

### 1Password 連携の仕組み

#### シークレット構成

```
GitHub Secret (1つだけ)
  └── OP_SERVICE_ACCOUNT_TOKEN  ← 1Password Service Account トークン

1Password Vault: homebrew-tap
  └── nozomiishii-homebrew-bot (API Credential)
        ├── username   = App ID
        └── credential = Private Key (.pem)
```

GitHub に登録するのは `OP_SERVICE_ACCOUNT_TOKEN` の 1 つだけ。
App ID も秘密鍵も 1Password に集約することで、変更時に 1Password 側のみ対応すれば済む。

> App ID は秘密情報ではないが、GitHub Variable に分けると変更時に 2 箇所（1Password + GitHub）を
> 触る必要がある。1Password に集約すれば変更箇所が 1 箇所で完結する。

#### Vault 名の設計

Vault 名は **`homebrew-tap`**（GitHub App がアクセスするリポジトリと一致させる）。

GitHub App は `homebrew-tap` リポジトリ専用の認証情報なので、
リポジトリごとの Vault（`git-harvest` 等）ではなく、対象リポジトリ名の Vault に入れるのが自然。
複数ツールの CI から同じ Vault を参照する構成になる。

#### 1Password のアイテムタイプ

**API Credential** を使用する。GitHub App の認証情報は API アクセス用途であり、
Login（Web ログイン向け）や Secure Note（構造なし）より適切。

フィールドの対応:

| 1Password フィールド | 値 | 説明 |
|---|---|---|
| **username** | App ID の数字 | API Credential のデフォルトフィールドをそのまま使用 |
| **credential** | `.pem` ファイルの中身 | `-----BEGIN RSA PRIVATE KEY-----` から `-----END RSA PRIVATE KEY-----` まで全体を貼り付ける |

> `.pem` の BEGIN / END 行を含めないと PEM として認識されない。必ず全体を貼り付けること。

ノートには以下を記載しておくと後から分かりやすい:

```
GitHub App: nozomiishii-homebrew-bot
username = App ID
credential = Private Key (.pem)
Used by: release.yaml homebrew-update job
```

#### Service Account の設計

Service Account 名は **`homebrew-tap`**（Vault 名と合わせる）。

Service Account をリポジトリごとに分けるか共有するかの判断:

```
OP_SERVICE_ACCOUNT_TOKEN が漏洩した場合:
  → homebrew-tap Vault が読まれる
  → GitHub App の秘密鍵が取られる
  → 秘密鍵の再生成が必要（App ID・Service Account の数に関係なく同じ作業）
```

Service Account を分けても、漏洩時の**被害範囲と対処は同じ**。
分けると管理する Service Account が増えるだけなので、**共有で良い**。

### GitHub App のセットアップ手順

#### App の作成（GitHub UI — 1 回のみ）

1. `https://github.com/settings/apps/new` を開く
2. 設定内容:

| 項目 | 値 |
|---|---|
| App name | `nozomiishii-homebrew-bot`（任意、GitHub 全体でユニーク） |
| Homepage URL | `https://github.com/nozomiishii` |
| Identifying and authorizing users | 全てデフォルトのまま（CI 専用なので使わない） |
| Post installation | 全てデフォルトのまま |
| Webhook | `Active` のチェックを**外す** |
| Permissions | Repository permissions → Contents → **Read & Write**（他は全部 No access） |
| Where can this app be installed? | `Only on this account` |

3. **Create GitHub App** をクリック
4. 表示される **App ID**（数字）を控える
5. ページ下部の Private keys セクションで **Generate a private key** → `.pem` ファイルがダウンロードされる
6. 左メニューの **Install App** → 自分のアカウント → **Only select repositories** → `homebrew-tap` を選択

> GitHub CLI (`gh`) では App の作成・秘密鍵生成はできない。UI での手動操作が必須（1 回のみ）。
> 将来新しいツールを追加する場合、Install App の設定で `homebrew-tap` が既に選択済みなので再設定不要。

#### 1Password の設定

1. `homebrew-tap` Vault を作成（既存でも可）
2. **API Credential** アイテムを作成:
   - タイトル: `nozomiishii-homebrew-bot`
   - username: App ID の数字
   - credential: `.pem` ファイルの中身（BEGIN〜END 行を含む全体）
   - ノート: 上記のメモを記載
3. Developer → Infrastructure Secrets → Service Accounts で Service Account を作成:
   - 名前: `homebrew-tap`
   - `homebrew-tap` Vault への **read** 権限を付与
   - 有効期限: 設定しない（デフォルト無期限）
4. 生成されたトークンをコピー（この画面を閉じると二度と表示されない）

#### GitHub Secret の登録

```bash
gh secret set OP_SERVICE_ACCOUNT_TOKEN -R nozomiishii/git-harvest
```

対話型プロンプトが表示されるので、Service Account トークンを貼り付けて Enter。
画面には表示されない。登録するのはこの **1 つだけ**。

### release.yaml への homebrew-update ジョブ追加

```yaml
  homebrew-update:
    needs: release-please
    if: needs.release-please.outputs.release_created == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    concurrency:
      group: homebrew-update
      cancel-in-progress: false
    permissions:
      contents: read

    steps:
      - name: Load secrets from 1Password
        uses: 1password/load-secrets-action@581a835fb51b8e7ec56b71cf2ffddd7e68bb25e0 # v2
        with:
          export-env: true
        env:
          OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
          APP_ID: op://homebrew-tap/nozomiishii-homebrew-bot/username
          APP_PRIVATE_KEY: op://homebrew-tap/nozomiishii-homebrew-bot/credential

      - name: Generate GitHub App token
        id: app-token
        uses: actions/create-github-app-token@d72941d797fd3113feb6b93fd0dec494b13a2547 # v1
        with:
          app-id: ${{ env.APP_ID }}
          private-key: ${{ env.APP_PRIVATE_KEY }}
          owner: nozomiishii
          repositories: homebrew-tap

      - name: Update Homebrew formula
        uses: mislav/bump-homebrew-formula-action@ccf2332299a883f6af50a1d2d41e5df7904dd769 # v4
        with:
          formula-name: git-harvest
          homebrew-tap: nozomiishii/homebrew-tap
          tag-name: ${{ needs.release-please.outputs.tag_name }}
          commit-message: |
            {{formulaName}} {{version}}
        env:
          COMMITTER_TOKEN: ${{ steps.app-token.outputs.token }}
```

リリースの自動化フロー:

```
release-please が新バージョンをリリース
  ↓
homebrew-update ジョブが起動
  ↓
1Password から App ID と秘密鍵を取得
  ↓
秘密鍵から 1 時間有効の Installation Token を生成
  ↓
mislav/bump-homebrew-formula-action が以下を自動実行:
  - tarball をダウンロードし SHA256 を計算
  - GitHub API で Formula の url / sha256 / version を更新
  - homebrew-tap にコミット
```

設計上のポイント:

| ポイント | 内容 |
|---|---|
| Actions の SHA ピン留め | 全アクションを SHA で固定。サプライチェーン攻撃を防止 |
| concurrency 制御 | 連続リリース時のレースコンディションを防止 |
| SHA256 の自動検証 | アクション内部で tarball をダウンロードしハッシュを計算。失敗時は自動でエラー |
| sed / clone 不要 | GitHub API ベースのため formula の構文破壊リスクがない |

## 段階的な導入フロー

### Phase 1: Formula を公開

| ステップ | 実行者 | 内容 |
|---|---|---|
| 1. リポジトリ作成 | 自動化可能 | `gh repo create` で `homebrew-tap` を作成 |
| 2. Formula 作成 | 自動化可能 | SHA256 計算 + `gh api` で Formula を push |
| 3. インストール確認 | **手動** | `brew install` でローカルで動作確認 |
| 4. 品質チェック | **手動** | `brew audit` でローカルで確認 |

この段階では CI 不要。リリース時に手動で `url` と `sha256` を更新する。

### Phase 2: CI 自動化を追加

| ステップ | 実行者 | 内容 |
|---|---|---|
| 1. GitHub App 作成 | **手動** | GitHub UI でのみ可能（API/CLI 非対応） |
| 2. 1Password 設定 | **手動** | Vault 作成、API Credential 保存、Service Account 作成 |
| 3. Secret 登録 | **手動** | `gh secret set` で `OP_SERVICE_ACCOUNT_TOKEN` を対話型プロンプトで登録 |
| 4. release.yaml 更新 | 自動化可能 | `homebrew-update` ジョブを追加 |

以降はリリースのたびに Formula が自動更新される。

## 将来の新ツール追加時の手順

1. `homebrew-tap/Formula/new-tool.rb` に Formula を追加
2. 新ツールのリポジトリに `homebrew-update` ジョブを追加
3. 新ツールのリポジトリに `OP_SERVICE_ACCOUNT_TOKEN` を登録（同じ Service Account トークンを使用）

GitHub App の再作成・再インストールは**不要**（同じ App が `homebrew-tap` リポジトリへの write 権限を持っているため）。
1Password の Vault・Service Account も既存のものをそのまま使う。
