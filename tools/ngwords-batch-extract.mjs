#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const NGWORDS_PATH = join(process.env.NEKO_NOT_YOSHI_DIR || 'C:/work/neko-not-yoshi', 'ngwords.private.json');
const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3-coder';
const VALID_CATEGORIES = ['pii', 'customer', 'network', 'credential', 'financial', 'local-path', 'custom'];
const WHITELIST_PATH = join(process.env.NEKO_NOT_YOSHI_DIR || 'C:/work/neko-not-yoshi', 'ngwords-whitelist.json');
const SUPPORTED_EXT = new Set(['.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pptx', '.pdf', '.txt', '.csv', '.md', '.html']);

function parseArgs(argv) {
  const args = { dir: null, exts: [], apply: false, model: DEFAULT_MODEL, host: DEFAULT_HOST, limit: 0, recursive: false, numCtx: 0, maxChars: 30000 };
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--apply') { args.apply = true; }
    else if (a === '--model' && argv[i + 1]) { args.model = argv[++i]; }
    else if (a === '--host' && argv[i + 1]) { args.host = argv[++i]; }
    else if (a === '--ext' && argv[i + 1]) { args.exts.push(argv[++i].startsWith('.') ? argv[i] : '.' + argv[i]); }
    else if (a === '--limit' && argv[i + 1]) { args.limit = parseInt(argv[++i], 10); }
    else if (a === '--recursive' || a === '-r') { args.recursive = true; }
    else if (a === '--num-ctx' && argv[i + 1]) { args.numCtx = parseInt(argv[++i], 10); }
    else if (a === '--max-chars' && argv[i + 1]) { args.maxChars = parseInt(argv[++i], 10); }
    else if (!a.startsWith('--')) { args.dir = a; }
    i++;
  }
  return args;
}

const SYSTEM_MSG = `あなたは情報セキュリティの専門家です。ユーザーが渡すドキュメントから機密情報を抽出し、JSON配列のみを返してください。説明・要約・マークダウンは一切出力しないでください。

【重要】以下は一般用語であり、抽出しないでください:
- パブリックなクラウドサービス名（AWS, EC2, S3, Azure, GCP等）
- コンプライアンス規格名（ISO 27001, SOC 2, HIPAA等）
- 一般的なIT用語・プロトコル名（API, VPN, HTTP等）
- 汎用ロール名（PM, SE, PG等）
- プレースホルダ（XXX, サンプル等）
- 一般的な日本語ビジネス用語（顧客、事業者、インフラ等）
- ドキュメントの見出し・セクション名`;

function buildMessages(content, filename) {
  return [
    { role: 'system', content: SYSTEM_MSG },
    { role: 'user', content: `ファイル「${filename}」の内容:
${content}

上記ドキュメントから、外部に漏洩してはいけない機密情報を全て抽出してください。

抽出対象（カテゴリ別）:
- pii: 個人名（フルネーム）、メールアドレス、電話番号、住所、マイナンバー、生年月日
- customer: 顧客名・取引先名・ベンダー名（IT企業含む）、未公開プロジェクト名・コードネーム、社内システム固有名称、契約金額・見積金額
- credential: パスワード、APIキー、アクセストークン、秘密鍵、DB接続文字列、セッションID
- network: 内部IPアドレス(10.x/172.16-31.x/192.168.x)、内部URL・ホスト名、VPN接続情報、ファイアウォールルール
- financial: クレジットカード番号、銀行口座番号

以下のJSON配列のみを出力してください。説明や要約は絶対に書かないでください:
[{"value":"抽出した語","category":"pii","severity":"block"}]` },
  ];
}

function sanitize(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t\x00-\x1f]/g, '').trim();
}

function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function parseResponse(rawText) {
  const text = stripThinking(rawText);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fallback */ }
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fallback */ }
  }
  return null;
}

function isPlaceholder(value) {
  if (/[○△□×＊※●■◆☆★]/.test(value)) return true;
  if (/^(TEL|FAX|E-Mail|担当|住所|氏名|名前|電話|メール)[：:]?\s*$/.test(value)) return true;
  if (/^<.*>$/.test(value)) return true;
  return false;
}

function convertWithPymupdf(filePath) {
  try {
    const script = `import fitz,sys;doc=fitz.open(sys.argv[1]);print(''.join(p.get_text() for p in doc));doc.close()`;
    return execFileSync('python', ['-c', script, filePath], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch { return null; }
}

function convertToText(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (['.txt', '.csv', '.md'].includes(ext)) {
    return readFileSync(filePath, 'utf8');
  }
  try {
    const result = execFileSync('markitdown', [filePath], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result && result.trim().length >= 10) return result;
  } catch { /* fallback below */ }
  if (ext === '.pdf') {
    const fallback = convertWithPymupdf(filePath);
    if (fallback && fallback.trim().length >= 10) return fallback;
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

function loadExisting() {
  if (!existsSync(NGWORDS_PATH)) return [];
  try {
    return JSON.parse(readFileSync(NGWORDS_PATH, 'utf8')).words || [];
  } catch { return []; }
}

function loadWhitelist() {
  if (!existsSync(WHITELIST_PATH)) return new Set();
  try {
    const data = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
    return new Set((data.words || []).map(w => w.toLowerCase()));
  } catch { return new Set(); }
}

function isWhitelisted(value, whitelist) {
  return whitelist.has(value.toLowerCase());
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.dir) {
    console.log('Usage: node tools/ngwords-batch-extract.mjs <dir> [--ext xlsx] [--ext docx] [--apply] [--limit N]');
    process.exit(0);
  }

  const health = await checkConnection(args.host);
  if (!health.ok) {
    console.error('Ollama に接続できません: ' + health.error);
    process.exit(1);
  }
  if (!health.models.some(m => m.startsWith(args.model))) {
    console.error('モデル ' + args.model + ' が見つかりません');
    process.exit(1);
  }

  const extFilter = args.exts.length > 0 ? new Set(args.exts) : SUPPORTED_EXT;
  let files;
  try {
    files = readdirSync(args.dir, { recursive: args.recursive, withFileTypes: true })
      .filter(e => e.isFile() && extFilter.has(extname(e.name).toLowerCase()))
      .map(e => join(e.parentPath || e.path, e.name));
  } catch (err) {
    console.error('ディレクトリ読み取り失敗: ' + err.message);
    process.exit(1);
  }

  if (args.limit > 0) files = files.slice(0, args.limit);

  console.log('対象: ' + files.length + '件 (' + [...extFilter].join(', ') + ')');
  console.log('モデル: ' + args.model);
  console.log('');

  const existing = loadExisting();
  const existingValues = new Set(existing.map(w => w.value));
  const whitelist = loadWhitelist();
  const allCandidates = new Map();
  let whitelistFiltered = 0;

  if (whitelist.size > 0) console.log('ホワイトリスト: ' + whitelist.size + '件ロード済み');
  console.log('');
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    processed++;
    const name = basename(file);
    process.stdout.write('[' + processed + '/' + files.length + '] ' + name + ' ... ');

    const text = convertToText(file);
    if (!text || text.trim().length < 10) {
      console.log('SKIP (変換失敗 or 空)');
      skipped++;
      continue;
    }

    const truncated = text.length > args.maxChars ? text.slice(0, args.maxChars) : text;

    const start = Date.now();
    let responseText;
    try {
      responseText = await callOllama(args.host, args.model, buildMessages(truncated, name), args.numCtx);
    } catch (err) {
      console.log('ERROR (' + err.message + ')');
      errors++;
      continue;
    }
    const elapsed = Math.round((Date.now() - start) / 1000);

    const candidates = parseResponse(responseText);
    if (!candidates) {
      console.log('PARSE_FAIL (' + elapsed + 's)');
      errors++;
      continue;
    }

    let newCount = 0;
    for (const c of candidates) {
      const value = sanitize(c.value);
      if (!value || value.length < 2) continue;
      if (isPlaceholder(value)) continue;
      if (isWhitelisted(value, whitelist)) { whitelistFiltered++; continue; }
      if (existingValues.has(value)) continue;
      if (allCandidates.has(value)) continue;

      const category = VALID_CATEGORIES.includes(c.category) ? c.category : 'customer';
      const severity = c.severity === 'warning' ? 'warning' : 'block';
      allCandidates.set(value, { value, category, severity });
      newCount++;
    }

    console.log('OK ' + candidates.length + '件抽出, ' + newCount + '件新規 (' + elapsed + 's)');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('処理: ' + processed + '件, スキップ: ' + skipped + '件, エラー: ' + errors + '件');
  console.log('ユニーク候補: ' + allCandidates.size + '件');
  if (whitelistFiltered > 0) console.log('ホワイトリスト除外: ' + whitelistFiltered + '件');

  const sorted = [...allCandidates.values()].sort((a, b) => a.category.localeCompare(b.category));

  const reportPath = join(args.dir, '_ngword-candidates.json');
  writeFileSync(reportPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');

  const byCat = {};
  for (const c of sorted) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const catSummary = Object.entries(byCat).map(([k, v]) => k + ':' + v).join(', ');

  console.log('候補: ' + sorted.length + '件 (' + catSummary + ')');
  console.log('詳細: ' + reportPath);

  if (allCandidates.size === 0) {
    process.exit(0);
  }

  if (!args.apply) {
    console.log('確認後 --apply で辞書に追記してください。');
    process.exit(0);
  }

  const merged = [...existing, ...sorted];
  writeFileSync(NGWORDS_PATH, JSON.stringify({ words: merged }, null, 2) + '\n', 'utf8');
  console.log(sorted.length + '件を辞書に追記しました。');
}

main().catch(err => {
  console.error('エラー: ' + err.message);
  process.exit(1);
});
