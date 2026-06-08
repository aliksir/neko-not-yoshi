#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-coder-64k';
const BATCH_SIZE = 30;

function parseArgs(argv) {
  const args = { input: null, output: null, model: DEFAULT_MODEL, host: DEFAULT_HOST, numCtx: 16384 };
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--model' && argv[i + 1]) args.model = argv[++i];
    else if (a === '--host' && argv[i + 1]) args.host = argv[++i];
    else if (a === '--num-ctx' && argv[i + 1]) args.numCtx = parseInt(argv[++i], 10);
    else if (!args.input) args.input = a;
    else if (!args.output) args.output = a;
    i++;
  }
  return args;
}

const SYSTEM_MSG = `あなたは情報セキュリティの専門家です。
与えられた語句リストの各項目について、以下の基準で判定してください:

【除外すべき一般ワード】
- パブリックな製品名・サービス名・企業名（AWS, EC2, Microsoft等）
- 業界標準の技術用語・プロトコル名（HTTP, VPN, API等）
- コンプライアンス規格名（ISO 27001, SOC 2等）
- 一般的な日本語ビジネス用語（顧客、事業者、インフラ等）
- プレースホルダ・サンプルデータ（XXX、A社等）
- 汎用的な役職名・チーム名（PM, SE等）
- 公知の組織名・団体名
- ドキュメントのセクション名・見出し

【NGワードとして残すべき機密情報】
- 特定の個人名（フルネーム）
- 特定の企業の内部プロジェクト名（公開されていないもの）
- 内部IPアドレス・内部URL（192.168.x.x, 10.x.x.x等）
- 内部システム名（社外に公開されていない固有名称）
- メールアドレス
- 電話番号
- 社内専用のコード・ID

JSON配列のみを返してください。各項目に "keep": true（機密）または false（一般ワード）を付けてください。
thinkingタグは不要です。`;

function buildPrompt(batch) {
  const list = batch.map((item, i) => `${i + 1}. "${item.value}" (${item.category})`).join('\n');
  return `以下の${batch.length}件の語句を判定してください:

${list}

各項目について以下のJSON配列を返してください:
[{"index":1,"value":"...","keep":true/false,"reason":"判定理由（5文字以内）"}]`;
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function parseResponse(rawText, batchSize) {
  const text = stripThinking(rawText);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallback */ }
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fallback */ }
  }
  return null;
}

async function callOllama(host, model, messages, numCtx) {
  const body = { model, messages, stream: false };
  if (numCtx > 0) body.options = { num_ctx: numCtx };
  const res = await fetch(host + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Ollama API error: ' + res.status);
  const data = await res.json();
  return data.message.content;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.log('Usage: node tools/ngwords-llm-rejudge.mjs <input.json> [output.json]');
    process.exit(0);
  }

  const candidates = JSON.parse(readFileSync(args.input, 'utf8'));
  const outputPath = args.output || args.input.replace('.json', '-rejudged.json');

  console.log('入力:', candidates.length, '件');
  console.log('モデル:', args.model);
  console.log('バッチサイズ:', BATCH_SIZE);
  console.log('');

  const kept = [];
  const removed = [];
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(candidates.length / BATCH_SIZE);
    process.stdout.write('[' + batchNum + '/' + totalBatches + '] ' + batch.length + '件判定中 ... ');

    const start = Date.now();
    let responseText;
    try {
      responseText = await callOllama(
        args.host, args.model,
        [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: buildPrompt(batch) }],
        args.numCtx
      );
    } catch (err) {
      console.log('ERROR (' + err.message + ')');
      errors++;
      kept.push(...batch);
      continue;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);

    const results = parseResponse(responseText, batch.length);
    if (!results) {
      console.log('PARSE_FAIL (' + elapsed + 's)');
      errors++;
      kept.push(...batch);
      continue;
    }

    let batchKept = 0;
    let batchRemoved = 0;
    for (let j = 0; j < batch.length; j++) {
      const result = results.find(r => r.index === j + 1);
      if (result && result.keep === false) {
        removed.push({ ...batch[j], reason: result.reason || '' });
        batchRemoved++;
      } else {
        kept.push(batch[j]);
        batchKept++;
      }
    }

    processed += batch.length;
    console.log('kept:' + batchKept + ' removed:' + batchRemoved + ' (' + elapsed + 's)');
  }

  console.log('');
  console.log('='.repeat(50));
  console.log('処理:', processed, '件, エラー:', errors, '件');

  const byCat = {};
  for (const c of kept) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const catStr = Object.entries(byCat).map(([k, v]) => k + ':' + v).join(', ');

  console.log('残り(機密):', kept.length, '(' + catStr + ')');
  console.log('除外(一般):', removed.length);

  writeFileSync(outputPath, JSON.stringify(kept, null, 2) + '\n', 'utf8');
  console.log('保存:', outputPath);

  const removedPath = outputPath.replace('.json', '-removed.json');
  writeFileSync(removedPath, JSON.stringify(removed, null, 2) + '\n', 'utf8');
  console.log('除外リスト:', removedPath);
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
