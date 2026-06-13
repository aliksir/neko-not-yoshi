> English version: [README.md](README.md)
> [neko-HQ](https://github.com/aliksir/neko-hq) エコシステムの一部です。

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

## インストール

```bash
git clone https://github.com/aliksir/neko-not-yoshi.git
cd neko-not-yoshi
```

依存パッケージなし（ゼロ依存設計）。

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

### import — NGワード一括インポート

    node src/cli.mjs import words.csv      # CSV（value,category,severity）
    node src/cli.mjs import words.txt      # TXT（1行1ワード、デフォルト custom/block）
    node src/cli.mjs import words.md       # Markdownテーブル（| value | category | severity |）

重複は自動スキップ。全エントリは private リストに追加される。

インポートファイルのサンプルは [examples/](examples/) を参照。


### export — NGワードエクスポート

    node src/cli.mjs export                # CSV で stdout 出力（デフォルト）
    node src/cli.mjs export --format txt   # value のみ
    node src/cli.mjs export --format md    # Markdownテーブル
    node src/cli.mjs export --public       # public パターンも含む

> **セキュリティに関する注意**: デフォルトでは **private** リスト（顧客名・個人名等）が出力されます。出力ファイル自体が機密情報になります。
> - 出力ファイルは `.gitignore` に追加し、**コミット・共有しないでください**
> - `--public` を指定すると public の正規表現パターンも追加で出力されます（private は常に含まれます）
> - 出力先は `.gitignore` 済みのディレクトリ（例: `exports/`）を推奨します

### mask — 伏字化

    node src/cli.mjs mask <path>           # dry-run（プレビューのみ）
    node src/cli.mjs mask <path> --write   # 実ファイル書換（git 管理下推奨）

## 走査範囲

- **デフォルト**: git 追跡ファイル + **未追跡（.gitignore 対象外）ファイル**を走査し、.gitignore 済みのみ除外（`git ls-files --cached --others --exclude-standard` 相当）。git 管理外なら全ファイル走査
- **`--all`**: .gitignore 済みも含む全走査
- これにより `git add` 前の未追跡新規ファイル（漏洩しうる）も検査し、.gitignore 済みのローカル生成物（実行ログ等）は除外する
- **注**: private 語の ASCII マッチは case-sensitive（`Acme` 登録で `acme` は別扱い）。顧客名は登録時の表記に注意
- **注**: `allowlist.json` の `**/test/**` 許可は自身の test フィクスチャ用。**test フィクスチャには本物の個人情報を置かず**、RFC5737 予約IP（`203.0.113.x`/`198.51.100.x`）や `example.org` 等の予約サンプルを使うこと（本物の漏洩を見逃さないため）

## 完了ゲート統合

公開リポへの push を伴うタスクの完了ゲートで実行し、exit 0（block ゼロ）を確認してから push する。

    node src/cli.mjs scan <repo> && git push

## NGワードリストの運用

- **公開版** (`ngwords.public.json`): 正規表現パターンのみ。リポ同梱可
- **非公開版** (`ngwords.private.json`): 顧客名実体。`.gitignore` で除外、手元限定。`ngwords.private.example.json` をコピーして作る
- **allowlist** (`allowlist.json`): OSS作者表記など正当な公開情報を許可（pathGlob で限定）。各エントリは `action` を持つ:
  - `"allow"`（既定）: 完全許可（`match` 必須）。finding 自体を抑制する
  - `"downgrade"`: `block`→`warning` に降格（`match` 省略可、`pathGlob` / `category` で限定）。finding は残るので報告には出るが exit 0（push は通る）= **見逃さない**。セキュリティ検知ルール（`**/semgrep-rules/**` 配下の IOC・架空攻撃サンプル等、ツールの検知対象であり自リポの漏洩ではないもの）の false positive 抑制に使う。`customer`（顧客名）カテゴリは降格対象外（不変条件保護）

- **ホワイトリスト** (`ngwords-whitelist.json` + `ngwords-whitelist.local.json`): スキャン対象外とする一般IT用語。詳細は下記 [ホワイトリスト](#ホワイトリストfalse-positive-削減) を参照

### ホワイトリスト（False Positive 削減）

ホワイトリストに登録された用語はNGワードマッチから除外される（大文字小文字を区別しない）。これにより、一般的なIT用語（例: 「AWS」「Kubernetes」「OAuth」）が private リストのパターンで誤検出されるのを防ぐ。

2つのホワイトリストファイルをサポートし、`loadWhitelist()` で読み込み時にマージされる:

| ファイル | Git追跡 | 用途 |
|---------|---------|------|
| `ngwords-whitelist.json` | あり | 公開可能な一般IT用語（クラウドサービス、プロトコル、OSS名） |
| `ngwords-whitelist.local.json` | なし（.gitignore） | 環境固有の用語（公開に適さないもの） |

**フォーマット**（両ファイル共通）:
```json
{
  "version": "3.0",
  "description": "...",
  "words": ["ACM", "AKS", "ALB", "Amazon Web Services", "..."]
}
```

**動作**:
- スキャン時、private ワードの値がホワイトリストのエントリと一致（大文字小文字無視）すればスキップされる
- 公開版ホワイトリストには 319 件のキュレーション済み一般IT用語を同梱（AWS/Azure/GCP サービス、OSSプロジェクト、プロトコル、規格）
- ローカル版には環境固有の追加用語を登録できる
- マッチは完全一致（大文字小文字無視）。「API」がホワイトリストにあっても「API Gateway」はスキップされない

**allowlist と ホワイトリストの違い**:

| | allowlist (`allowlist.json`) | ホワイトリスト (`ngwords-whitelist*.json`) |
|---|---|---|
| **スコープ** | 検出単位（パス + カテゴリ） | 用語単位（グローバル） |
| **効果** | 特定の検出を抑制または降格 | 用語自体をマッチ対象から除外 |
| **用途** | 特定ファイルの既知 false positive | そもそも機密でない一般用語 |
### IOC降格ルール（公開脅威インテリの C2 IP 等、v0.1.4〜）

セキュリティ検知ツールのリポは、攻撃者の C2 IP（脅威インテリの IOC）を `semgrep-rules/` ではなく README / 検知スクリプト本体に直書きすることがある（例: [nextjs-security-scanner](https://github.com/aliksir/nextjs-security-scanner) は CVE-2025-55182 React2Shell の Cisco Talos C2 IP を `scan.sh` / `README.md` / `README_ja.md` / `claude-code/SKILL.md` に記載）。これらは**ツールの検知対象であって自リポの漏洩ではない**ため、誤検出（block）になる。

これを **per-IP x ファイル限定の `downgrade` エントリ**で抑制する（`allowlist.json` 参照）:

```json
{"action":"downgrade","match":"<IOC IP>","category":["network"],"pathGlob":"**/scan.sh"}
```

- **歯止めは2層**: `match`=特定の IOC IP（厳密リテラル、サブネット/wildcard 不使用）+ `pathGlob`=IOC が出現する実ファイル。これにより、未列挙の本物グローバルIP（将来の漏洩含む）・同一ファイル内の本物IP・`pathGlob` 外の IOC IP は全て **block 維持**（FN ゼロ）。
- **`pathGlob` は実 relPath のファイルを指定**（`**/scan.sh` 等）。リポ名（`**/nextjs-security-scanner/**`）は `cd repo && scan .` で relPath にリポ名が付かないため**効かない**ので使わない。
- **ブレース展開 `{a,b}` は未対応**（silent fail で FN になる）。必ず 1ファイル1 `pathGlob` で列挙する。
- **スナップショット注記**: これらのエントリは登録時点の対象リポに対する snapshot。対象リポが IOC ファイルを追加/改名したら `allowlist.json` の再整備が必要（漏れても FP=過剰ブロックで安全側、FN にはならない）。

**新しい IOC リポを追加する手順**（運用）:
1. 対象リポを `scan` し、`block` になる IOC IP と出現ファイル（relPath）を特定する
2. その IP が**公開された脅威インテリ（Cisco Talos / NVD 等）の IOC であり自リポの漏洩でないこと**を人間が確認する（誤って本物の漏洩IPを許可しない歯止め）
3. `allowlist.json` に `{"action":"downgrade","match":"<IP>","category":["network"],"pathGlob":"**/<file>"}` を IP x 出現ファイルぶん追記する
4. 再 `scan` で `block=0`、当該 IP が `warning` に残ること（FNゼロ）を確認する

## 暗号化（保存時保護）

private NGワードリスト（`ngwords.private.json`）には実際の顧客名や機密用語が含まれる。追加の保護として、AES-256-GCM で保存時暗号化できる。

### 鍵管理

暗号化鍵は以下の優先順位で解決される（最初に見つかったものを使用）:

| 優先度 | ソース | 設定方法 |
|--------|--------|----------|
| 1 | `NEKO_ENCRYPT_KEY` 環境変数 | Base64エンコードされた256ビット生鍵 |
| 2 | `NEKO_ENCRYPT_PASSPHRASE` 環境変数 | パスフレーズ（scrypt で鍵導出） |
| 3 | `.neko-keyfile`（プロジェクトルート） | `keygen` コマンドで生成 |

### 使い方

    # ステップ1: 鍵を生成（.neko-keyfile に保存、.gitignore 対象）
    node src/cli.mjs keygen

    # stdout に鍵を出力（環境変数設定用）
    node src/cli.mjs keygen --stdout

    # ステップ2: private リストを暗号化
    node src/cli.mjs encrypt

    # 暗号化して平文を削除
    node src/cli.mjs encrypt --delete-source

    # ステップ3: 必要時に復号
    node src/cli.mjs decrypt

### 動作の仕組み

- `encrypt` は `ngwords.private.json` を読み取り、暗号化して `ngwords.private.enc.json` に書き出す
- `decrypt` はその逆（暗号化ファイルから平文に戻す）
- **透過的復号**: `scan` は `ngwords.private.json` がない場合、`ngwords.private.enc.json` を自動検出・メモリ上で復号する — スキャンのために手動復号は不要
- `.neko-keyfile` と `ngwords.private.enc.json` はどちらも `.gitignore` 対象
- 暗号化形式は認証付き暗号（GCM）を使用し、改ざんを検出できる

### 推奨ワークフロー

1. 鍵を生成: `node src/cli.mjs keygen`
2. private リストを暗号化: `node src/cli.mjs encrypt --delete-source`
3. スキャンは暗号化ファイルのまま透過的に動作
4. リスト編集時: `decrypt` → 変更 → `encrypt --delete-source`
## 免責事項 / Disclaimer

NEKO-not-yoshi はパターンマッチングと NG ワードリストに基づく**補助ツール**であり、**個人情報・顧客名・機密情報の 100% 完全な検出・除去を保証するものではありません**。正規表現や語リストに合致しない未知の漏洩、文脈依存の機密、難読化・暗号化された情報は見逃す可能性があります。**最終的な公開可否は必ず人間がレビューしてください。** 本ツールの使用により生じたいかなる漏洩・損害についても作者は責任を負いません。

This is an assistive tool based on pattern matching and NG-word lists. It does **NOT guarantee 100% complete detection or removal** of personal information, customer names, or confidential data. Unknown patterns, context-dependent secrets, and obfuscated/encrypted data may be missed. **Always have a human review before publishing.** The author assumes no liability for any leaks or damages arising from the use of this tool.

## ライセンス

MIT
