# neko-not-yoshi

個人情報・顧客名スキャナ。公開リポへの `git push` 前に、漏洩（個人情報・顧客名・グローバルIP）を機械検出して止める **最後の砦**。猫が "ヨシッ" と言えない（= 問題がある）ものを検出する。yoshi 系の依存ゼロ内製ツール。

## 特徴

- **依存ゼロ**（Node.js v22+）
- **NGワードリスト2種**:
  - `ngwords.public.json` — 正規表現パターン（email / ホームパス / 電話 / IP / ローカルパス）。具体名を含まないので公開可
  - `ngwords.private.json` — 顧客名・個人名の実体（`.gitignore` 対象、非公開）
- **severity 3層**: `block`（push 阻止 = exit 1）/ `warning`（報告のみ = exit 0）/ allowlist（false positive 抑制）
- **IP 検知**: グローバル IP = block / プライベート・ループバック・サブネットマスク = warning
- **マスク機能**: 検出箇所を伏字化（デフォルト dry-run、`--write` で実書換）

## 使い方

### scan — 漏洩チェック

    node src/cli.mjs scan <path>                       # block 検出で exit 1
    node src/cli.mjs scan <path> --format json         # JSON 出力
    node src/cli.mjs scan <path> --no-private          # private リスト無効
    node src/cli.mjs scan <path> --warnings-as-errors  # warning も exit 1

### add — NGワード登録（人手 + Claude 自動蓄積）

    node src/cli.mjs add --private "顧客名"                # private（.gitignore）に登録
    node src/cli.mjs add --public "regex" --category pii  # public パターン登録

### list — 登録リスト表示

    node src/cli.mjs list
    node src/cli.mjs list --private

### mask — 伏字化

    node src/cli.mjs mask <path>           # dry-run（プレビューのみ）
    node src/cli.mjs mask <path> --write   # 実ファイル書換（git 管理下推奨）

## 完了ゲート統合

公開リポへの push を伴うタスクの完了ゲートで実行し、exit 0（block ゼロ）を確認してから push する。

    node src/cli.mjs scan <repo> && git push

## NGワードリストの運用

- **公開版** (`ngwords.public.json`): 正規表現パターンのみ。リポ同梱可
- **非公開版** (`ngwords.private.json`): 顧客名実体。`.gitignore` で除外、手元限定。`ngwords.private.example.json` をコピーして作る
- **allowlist** (`allowlist.json`): OSS作者表記など正当な公開情報を許可（pathGlob で限定）

## ライセンス

MIT
