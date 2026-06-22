# 暗号化バンドル 再ビルド手順書

neko-not-yoshi / pii-mask-yoshi が使用する AES-256-GCM 暗号化バンドル（`dist/core.enc` + `dist/loader.mjs`）の再ビルド手順。

---

## 1. いつ再ビルドが必要か

### neko-not-yoshi

| 変更内容 | 再ビルド要否 |
|---------|------------|
| `src/scanner.mjs` の変更 | 必要 |
| `src/ngwords.mjs` の変更 | 必要 |
| `src/allowlist.mjs` の変更 | 必要 |
| `ngwords.public.json` の変更（パターン追加/削除） | 必要 |
| `allowlist.json` の変更（allowlist 追加/削除） | 必要 |
| `src/crypto.mjs` の変更 | 必要 |
| `allowlist.local.json` の変更 | **不要**（ランタイム時にディスクから読み込む） |

### pii-mask-yoshi

| 変更内容 | 再ビルド要否 |
|---------|------------|
| `src/patterns.mjs` の変更 | 必要 |
| `src/masker.mjs` の変更 | 必要 |
| `src/store.mjs` の変更 | **不要**（バンドル外、ランタイムで import） |

---

## 2. 前提条件

- Node.js 22 以上（`node --version` で確認）
- 外部依存なし（Node.js 標準モジュールのみ使用）
- `src/` 配下のソースファイルが最新状態であること

---

## 3. 再ビルド手順

### neko-not-yoshi

```sh
cd C:/work/neko-not-yoshi
node scripts/build-protected.mjs
```

### pii-mask-yoshi

```sh
cd C:/work/pii-mask-yoshi
node scripts/build-protected.mjs
```

成功時の出力例:

```
[build-protected] core.enc: XXXXX bytes
[build-protected] loader.mjs: generated
[build-protected] key embedded as 32-byte charCode array
```

---

## 4. 出力ファイル

どちらのプロジェクトも `dist/` に以下を生成する:

| ファイル | 内容 |
|---------|------|
| `dist/core.enc` | AES-256-GCM 暗号化バンドル（JSON 形式） |
| `dist/loader.mjs` | 復号ローダー（鍵をビルド時に埋め込み済み） |

`dist/` は git tracked。再ビルド後は必ずコミットする。

---

## 5. 動作確認方法

### neko-not-yoshi

```sh
cd C:/work/neko-not-yoshi
npm test
```

### pii-mask-yoshi

```sh
cd C:/work/pii-mask-yoshi
npm test
```

テストがすべて PASS であれば再ビルド成功。

---

## 6. 注意事項

### 鍵の扱い

- **鍵はビルドのたびに自動生成される**（`crypto.randomBytes(32)`）
- 鍵は `dist/loader.mjs` 内に charCode 配列として難読化されて埋め込まれる
- 鍵をファイルや環境変数に保存する必要はない
- 過去の `core.enc` と新しい `loader.mjs` は組み合わせ不可（鍵が変わるため）

### dist/ の git 管理

- `dist/core.enc` と `dist/loader.mjs` はどちらも git tracked
- 再ビルド後は必ずペアでコミットする（片方だけ更新すると復号失敗）

### ローカル専用ファイル（neko-not-yoshi のみ）

- `allowlist.local.json` はランタイムで読み込まれる（バンドルに含まれない）
- この ファイルは git 管理外。変更しても再ビルドは不要

---

## 7. 仕組み（概要）

```
ソース (.mjs) + JSONデータ
         |
  build-protected.mjs
         |
    factory 関数文字列 (CJS) を組み立て
         |
    AES-256-GCM で暗号化
         |
  dist/core.enc    dist/loader.mjs
  (暗号化バンドル)  (鍵埋め込み済みローダー)
```

ランタイムでは `loader.mjs` が `core.enc` を復号し、`new Function()` で実行する。ソースコードは配布物に平文では含まれない。
