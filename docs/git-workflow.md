# Git Workflow Guide

新しいリポジトリを作成する際の Git 運用ガイド。
main ブランチの履歴をリニアに保ち、リリースノートの重複を防ぐ構成。

## GitHub リポジトリ設定

### 1. PR マージ方法の制限

**Settings > General > Pull Requests** で以下のように設定する。

| 設定 | 値 |
|---|---|
| Allow merge commits | OFF |
| Allow squash merging | ON |
| Allow rebase merging | OFF |

Squash Merge のみ許可することで、PR が main にマージされる際に全コミットが1つに潰される。
ブランチ内でどのような履歴になっていても、main の履歴は常にリニアになる。

### 2. main への直接 push 禁止（Ruleset）

**Settings > Rules > Rulesets** で以下の Ruleset を作成する。

- **Name**: `Protect main branch`
- **Enforcement**: Active
- **Target branches**: `refs/heads/main`
- **Rules**: Require a pull request before merging（required approving review count: 0）

これにより main への変更は必ず PR 経由になる。
個人リポジトリではレビュー必須人数を 0 にしてセルフマージを許可する。

gh CLI で作成する場合:

```bash
gh api repos/{owner}/{repo}/rulesets \
  --method POST \
  --input - <<'JSON'
{
  "name": "Protect main branch",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    }
  ],
  "bypass_actors": []
}
JSON
```

## release-please の設定

Squash Merge のみの運用でも、過去の履歴にマージコミットが残っている場合にリリースノートが重複する可能性がある。
`exclude-commits-pattern` で `Merge pull request` コミットを除外しておく。

```json
{
  "exclude-commits-pattern": "^Merge pull request"
}
```

## なぜこの構成でうまくいくのか

```
設定1: Squash Merge のみ許可
  → main に入るコミットは常に PR ごとの 1 コミット
  → main の履歴がリニアになる

設定2: main への直接 push 禁止
  → 全ての変更が PR 経由になる
  → 設定1 が確実に適用される

結果:
  → release-please がコミットを正しく解析できる
  → リリースノートに重複が発生しない
  → git log が見やすい
```

## ローカル設定（任意）

ブランチ内の履歴も綺麗に保ちたい場合は、`git pull` 時に rebase をデフォルトにできる。
Squash Merge 運用では main の履歴には影響しないため、必須ではない。

```bash
git config pull.rebase true
```
