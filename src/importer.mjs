// NGワードのバルクインポート（csv/txt/md → private 辞書への追記）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_PATH = join(ROOT, 'ngwords.private.json');

// 許可されるカテゴリ・重大度の列挙（不正値は安全なデフォルトにフォールバック）
const VALID_SEVERITIES = new Set(['block', 'warning']);
const VALID_CATEGORIES = new Set(['pii', 'customer', 'network', 'local-path', 'custom']);

// 既存の private 辞書を読み込む（ファイルがなければ空辞書で初期化）
function loadPrivate() {
  if (!existsSync(PRIVATE_PATH)) return { words: [] };
  return JSON.parse(readFileSync(PRIVATE_PATH, 'utf8'));
}

function savePrivate(data) {
  writeFileSync(PRIVATE_PATH, JSON.stringify(data, null, 2) + '\n');
}

// CSV パーサ: 1行目がヘッダかどうか自動判定して読み飛ばす
function parseCsv(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('value') || first.includes('category') || first.includes('severity');
  const start = hasHeader ? 1 : 0;

  const entries = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',').map(s => s.trim());
    const value = parts[0];
    if (!value) continue;
    // 不正なカテゴリ/重大度は 'custom'/'block' にフォールバック
    const category = VALID_CATEGORIES.has(parts[1]) ? parts[1] : 'custom';
    const severity = VALID_SEVERITIES.has(parts[2]) ? parts[2] : 'block';
    entries.push({ value, category, severity });
  }
  return entries;
}

// TXT パーサ: '#' 始まり行をコメントとして除外
function parseTxt(content) {
  return content.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(value => ({ value, category: 'custom', severity: 'block' }));
}

// Markdown テーブルパーサ: セパレータ行と 'value'/'値' ヘッダ行を除外
function parseMd(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const entries = [];

  for (const line of lines) {
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    if (line.includes('---')) continue;

    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length < 1) continue;

    const lower0 = cells[0].toLowerCase();
    if (lower0 === 'value' || lower0 === '値') continue;

    const value = cells[0];
    if (!value) continue;
    const category = cells.length > 1 && VALID_CATEGORIES.has(cells[1]) ? cells[1] : 'custom';
    const severity = cells.length > 2 && VALID_SEVERITIES.has(cells[2]) ? cells[2] : 'block';
    entries.push({ value, category, severity });
  }
  return entries;
}

// 拡張子でパーサを選択し、重複を除いて private 辞書に追記する
export function importFile(filePath) {
  if (!existsSync(filePath)) {
    console.error('ファイルが見つかりません: ' + filePath);
    return { added: 0, skipped: 0, exitCode: 1 };
  }

  const content = readFileSync(filePath, 'utf8');
  const ext = extname(filePath).toLowerCase();

  // 拡張子ごとにパーサを切り替え
  let entries;
  if (ext === '.csv') entries = parseCsv(content);
  else if (ext === '.txt') entries = parseTxt(content);
  else if (ext === '.md') entries = parseMd(content);
  else {
    console.error('未対応の形式: ' + ext + ' (csv/txt/md のみ)');
    return { added: 0, skipped: 0, exitCode: 1 };
  }

  if (entries.length === 0) {
    console.log('インポート対象なし (0件)');
    return { added: 0, skipped: 0, exitCode: 0 };
  }

  const data = loadPrivate();
  data.words = data.words || [];
  const existing = new Set(data.words.map(w => w.value));

  let added = 0;
  let skipped = 0;
  for (const entry of entries) {
    if (existing.has(entry.value)) {
      skipped++;
      continue;
    }
    data.words.push(entry);
    existing.add(entry.value);
    added++;
  }

  if (added > 0) savePrivate(data);

  console.log('インポート完了: ' + added + '件追加, ' + skipped + '件スキップ(重複)');
  return { added, skipped, exitCode: 0 };
}

export { parseCsv, parseTxt, parseMd };
