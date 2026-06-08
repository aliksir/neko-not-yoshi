#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-coder-64k';
const BATCH_SIZE = 40;

const SYSTEM_MSG = `あなたは情報セキュリティの専門家です。
与えられたNGワードリストの各項目のカテゴリを正しく再分類してください。

【カテゴリ定義】
- pii: 個人名（フルネーム）、メールアドレス、電話番号、住所、マイナンバー、生年月日
- customer: 顧客名・取引先名・ベンダー名（IT企業含む）、未公開プロジェクト名・コードネーム、社内システム固有名称、契約金額・見積金額
- credential: パスワード、APIキー、アクセストークン、秘密鍵、DB接続文字列、セッションID、ユーザーID/パスワードのペア
- network: 内部IPアドレス(10.x/172.16-31.x/192.168.x)、内部URL・ホスト名、VPN接続情報、サーバー名・ポート番号
- financial: クレジットカード番号、銀行口座番号、金額（契約金額はcustomer）

【判定ルール】
- 値の内容を見てカテゴリを判定（現在のカテゴリは参考程度、間違いがあるので信用しない）
- パスワードやキーはcredential（customerやprojectではない）
- IPアドレスやホスト名はnetwork（infraではない）
- 人名はpii（personではない）
- infra/person/projectは廃止カテゴリ。適切なカテゴリに再分類すること

JSON配列のみを返してください。thinkingタグ不要。`;

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function parseResponse(rawText) {
  const text = stripThinking(rawText);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallback */ }
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* */ }
  }
  return null;
}

async function callOllama(host, model, messages) {
  const res = await fetch(host + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, options: { num_ctx: 16384 } }),
  });
  if (!res.ok) throw new Error('Ollama error: ' + res.status);
  return (await res.json()).message.content;
}

async function main() {
  const input = process.argv[2] || 'C:/work/neko-not-yoshi/ngwords.private.json';
  const data = JSON.parse(readFileSync(input, 'utf8'));
  const words = data.words || [];

  console.log('入力:', words.length, '件');
  let changed = 0;
  let errors = 0;

  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = words.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const total = Math.ceil(words.length / BATCH_SIZE);
    process.stdout.write('[' + batchNum + '/' + total + '] ' + batch.length + '件 ... ');

    const prompt = batch.map((w, j) => `${j + 1}. "${w.value}" (現在: ${w.category})`).join('\n');
    const userMsg = `以下の${batch.length}件を再分類してください:\n${prompt}\n\n[{"index":1,"value":"...","category":"正しいカテゴリ"}]`;

    const start = Date.now();
    try {
      const resp = await callOllama(DEFAULT_HOST, DEFAULT_MODEL,
        [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: userMsg }]);
      const results = parseResponse(resp);
      if (!results) { console.log('PARSE_FAIL'); errors++; continue; }

      let batchChanged = 0;
      for (let j = 0; j < batch.length; j++) {
        const r = results.find(x => x.index === j + 1);
        if (r && r.category && r.category !== batch[j].category) {
          const validCats = ['pii', 'customer', 'credential', 'network', 'financial'];
          if (validCats.includes(r.category)) {
            batch[j].category = r.category;
            batchChanged++;
            changed++;
          }
        }
      }
      console.log(batchChanged + '件変更 (' + Math.round((Date.now() - start) / 1000) + 's)');
    } catch (e) {
      console.log('ERROR (' + e.message + ')');
      errors++;
    }
  }

  console.log('');
  console.log('変更:', changed, '件, エラー:', errors);

  const byCat = {};
  for (const w of words) byCat[w.category] = (byCat[w.category] || 0) + 1;
  console.log('カテゴリ分布:', JSON.stringify(byCat));

  writeFileSync(input, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('保存:', input);
}

main().catch(e => { console.error(e.message); process.exit(1); });
