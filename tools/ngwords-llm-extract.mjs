#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const NGWORDS_PATH = join(process.env.NEKO_NOT_YOSHI_DIR || process.cwd(), 'ngwords.private.json');
const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-coder';
const VALID_CATEGORIES = ['pii', 'customer', 'network', 'local-path', 'custom'];

function parseArgs(argv) {
  const args = { files: [], apply: false, model: DEFAULT_MODEL, host: DEFAULT_HOST, category: null, severity: null };
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--apply') { args.apply = true; }
    else if (a === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (a === '--host' && argv[i + 1]) { args.host = argv[++i]; }
    else if (a === '--category' && argv[i + 1]) { args.category = argv[++i]; }
    else if (a === '--severity' && argv[i + 1]) { args.severity = argv[++i]; }
    else if (!a.startsWith('--')) { args.files.push(a); }
    i++;
  }
  return args;
}

function buildPrompt(content) {
  return `あなたは情報セキュリティの専門家です。
以下のドキュメントから、外部に漏洩してはいけない機密情報を抽出してください。

抽出対象:
- 顧客名・会社名（category: "customer"）
- 人名（category: "pii"）
- プロジェクトコード（category: "customer"）
- 社内システム名（category: "customer"）
- メールアドレス（category: "pii"）
- 電話番号（category: "pii"）
- 内部URL・IPアドレス（category: "network"）

出力形式（JSON配列のみ、説明は不要です）:
[{"value": "抽出した語", "category": "customer", "severity": "block"}]

ドキュメント:
${content}`;
}

function sanitize(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t\x00-\x1f]/g, '').trim();
}

function parseResponse(text) {
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

function loadExisting() {
  if (!existsSync(NGWORDS_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(NGWORDS_PATH, 'utf8'));
    return data.words || [];
  } catch {
    return [];
  }
}

async function callOllama(host, model, prompt) {
  const url = host + '/api/chat';
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Ollama API error: ' + res.status + ' ' + text);
  }

  const data = await res.json();
  return data.message.content;
}

async function checkConnection(host) {
  try {
    const res = await fetch(host + '/api/tags');
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    return { ok: true, models: (data.models || []).map(m => m.name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.files.length === 0) {
    console.log('Usage: node tools/ngwords-llm-extract.mjs <file...> [--apply] [--model name]');
    console.log('');
    console.log('Options:');
    console.log('  --apply         ngwords.private.json に追記（デフォルト: dry-run）');
    console.log('  --model <name>  Ollama モデル（デフォルト: qwen3-coder）');
    console.log('  --host <url>    Ollama ホスト（デフォルト: http://localhost:11434）');
    console.log('  --category <c>  カテゴリ上書き');
    console.log('  --severity <s>  severity 上書き');
    process.exit(0);
  }

  const health = await checkConnection(args.host);
  if (!health.ok) {
    console.error('Ollama に接続できません: ' + health.error);
    console.error('ollama serve を起動してください');
    process.exit(1);
  }

  if (!health.models.some(m => m.startsWith(args.model))) {
    console.error('モデル ' + args.model + ' が見つかりません');
    console.error('利用可能: ' + health.models.join(', '));
    console.error('ollama pull ' + args.model + ' を実行してください');
    process.exit(1);
  }

  const existing = loadExisting();
  const existingValues = new Set(existing.map(w => w.value));
  let allCandidates = [];

  for (const file of args.files) {
    if (!existsSync(file)) {
      console.error('ファイルが見つかりません: ' + file);
      process.exit(1);
    }

    const content = readFileSync(file, 'utf8');
    console.log('処理中: ' + file + ' (' + content.length + ' chars)');
    console.log('モデル: ' + args.model);

    const start = Date.now();
    let responseText;
    try {
      responseText = await callOllama(args.host, args.model, buildPrompt(content));
    } catch (err) {
      console.error('LLM 呼び出し失敗: ' + err.message);
      process.exit(1);
    }
    const elapsed = Date.now() - start;
    console.log('応答: ' + Math.round(elapsed / 1000) + '秒');

    const candidates = parseResponse(responseText);
    if (!candidates) {
      console.error('JSON パース失敗。生レスポンス:');
      console.error(responseText);
      process.exit(1);
    }

    for (const c of candidates) {
      const value = sanitize(c.value);
      if (!value) continue;

      const category = args.category || (VALID_CATEGORIES.includes(c.category) ? c.category : 'customer');
      const severity = args.severity || (c.severity === 'warning' ? 'warning' : 'block');

      allCandidates.push({ value, category, severity });
    }
  }

  const dedupBefore = allCandidates.length;
  allCandidates = allCandidates.filter(c => !existingValues.has(c.value));
  const seen = new Set();
  allCandidates = allCandidates.filter(c => {
    if (seen.has(c.value)) return false;
    seen.add(c.value);
    return true;
  });
  const dedupCount = dedupBefore - allCandidates.length;

  if (allCandidates.length === 0) {
    console.log('');
    console.log('新規候補なし（重複除外: ' + dedupCount + '件）');
    process.exit(0);
  }

  console.log('');
  console.log('=== NGワード候補（' + allCandidates.length + '件、重複除外: ' + dedupCount + '件） ===');
  for (const c of allCandidates) {
    console.log('  [' + c.category + ']' + ' '.repeat(Math.max(1, 12 - c.category.length)) + c.value);
  }

  if (!args.apply) {
    console.log('');
    console.log('適用するには --apply を付けて再実行してください。');
    process.exit(0);
  }

  const merged = [...existing, ...allCandidates];
  writeFileSync(NGWORDS_PATH, JSON.stringify({ words: merged }, null, 2) + '\n', 'utf8');
  console.log('');
  console.log(allCandidates.length + '件を ' + NGWORDS_PATH + ' に追記しました。');
}

main().catch(err => {
  console.error('エラー: ' + err.message);
  process.exit(1);
});
