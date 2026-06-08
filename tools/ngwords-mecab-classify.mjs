#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PYTHON_SCRIPT = `
import fugashi, json, sys
tagger = fugashi.Tagger()
items = json.load(sys.stdin)
results = []
for item in items:
    v = item['value']
    words = tagger(v)
    pos_list = []
    for w in words:
        f = w.feature
        pos_list.append({'surface': w.surface, 'pos1': f.pos1, 'pos2': f.pos2, 'pos3': f.pos3})
    has_proper = any(p['pos2'] == '固有名詞' for p in pos_list)
    all_common = all(p['pos2'] in ('普通名詞', '一般', 'サ変接続', '*') or p['pos1'] != '名詞' for p in pos_list)
    classification = 'proper' if has_proper else ('common' if all_common else 'mixed')
    results.append({**item, 'mecab_class': classification, 'pos': pos_list})
json.dump(results, sys.stdout, ensure_ascii=False)
`;

function parseArgs(argv) {
  const args = { input: null, output: null, whitelistOnly: false };
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--whitelist-only') args.whitelistOnly = true;
    else if (!args.input) args.input = a;
    else if (!args.output) args.output = a;
    i++;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.log('Usage: node tools/ngwords-mecab-classify.mjs <candidates.json> [output.json] [--whitelist-only]');
    console.log('');
    console.log('MeCabで形態素解析し、固有名詞/普通名詞を分類する。');
    console.log('  proper: 固有名詞を含む → NGワード候補（keep）');
    console.log('  common: 普通名詞のみ → ホワイトリスト候補');
    console.log('  mixed:  判定保留');
    console.log('');
    console.log('--whitelist-only: commonのみ出力（ホワイトリスト追加用）');
    process.exit(0);
  }

  const items = JSON.parse(readFileSync(args.input, 'utf8'));
  console.log('入力:', items.length, '件');

  let results;
  try {
    const out = execFileSync('python', ['-c', PYTHON_SCRIPT], {
      input: JSON.stringify(items),
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    });
    results = JSON.parse(out);
  } catch (err) {
    console.error('MeCab分類エラー:', err.message);
    process.exit(1);
  }

  const byClass = { proper: 0, common: 0, mixed: 0 };
  for (const r of results) byClass[r.mecab_class]++;

  console.log('分類結果:');
  console.log('  固有名詞(proper):', byClass.proper);
  console.log('  普通名詞(common):', byClass.common);
  console.log('  混合(mixed):', byClass.mixed);

  let output = results;
  if (args.whitelistOnly) {
    output = results.filter(r => r.mecab_class === 'common');
    console.log('ホワイトリスト候補:', output.length, '件');
  }

  const outPath = args.output || args.input.replace('.json', '-classified.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('保存:', outPath);
}

main();
