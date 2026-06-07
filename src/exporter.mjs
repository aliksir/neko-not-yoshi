import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function exportWords(format = 'csv', includePublic = false) {
  const entries = [];

  const privPath = join(ROOT, 'ngwords.private.json');
  if (existsSync(privPath)) {
    const priv = JSON.parse(readFileSync(privPath, 'utf8'));
    for (const w of priv.words || []) {
      entries.push({ value: w.value, category: w.category || 'custom', severity: w.severity || 'block', source: 'private' });
    }
  }

  if (includePublic) {
    const pub = JSON.parse(readFileSync(join(ROOT, 'ngwords.public.json'), 'utf8'));
    for (const p of pub.patterns || []) {
      entries.push({ value: p.regex || p.id, category: p.category || 'pii', severity: p.severity || 'block', source: 'public' });
    }
  }

  if (entries.length === 0) {
    console.log('エクスポート対象なし (0件)');
    return '';
  }

  const hasPrivate = entries.some(e => e.source === 'private');
  if (hasPrivate) {
    console.error('[WARNING] export結果には機密情報（顧客名・個人名等）が含まれます。');
    console.error('出力ファイルは .gitignore に追加し、共有・コミットしないでください。');
  }

  let output;
  switch (format) {
    case 'csv':
      output = 'value,category,severity\n' +
        entries.map(e => e.value + ',' + e.category + ',' + e.severity).join('\n');
      break;
    case 'txt':
      output = entries.map(e => e.value).join('\n');
      break;
    case 'md':
      output = '| value | category | severity |\n' +
        '|-------|----------|----------|\n' +
        entries.map(e => '| ' + e.value + ' | ' + e.category + ' | ' + e.severity + ' |').join('\n');
      break;
    default:
      console.error('未対応の形式: ' + format + ' (csv/txt/md のみ)');
      return '';
  }

  console.log(output);
  return output;
}
