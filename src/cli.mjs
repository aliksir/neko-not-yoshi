#!/usr/bin/env node
// neko-not-yoshi: 個人情報・顧客名スキャナ（公開前の漏洩チェック / 最後の砦）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scan } from './scanner.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PLACEHOLDERS = {
  pii: '<redacted-pii>',
  customer: '<redacted>',
  network: 'xxx.xxx.xxx.xxx',
  'local-path': '<redacted-path>',
};

function flagVal(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function cmdScan(args) {
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.error('scan: <path> が必要'); process.exit(2); }
  const format = flagVal(args, '--format') || 'text';
  const includePrivate = !args.includes('--no-private');
  const warningsAsErrors = args.includes('--warnings-as-errors');
  const all = args.includes('--all');
  const res = scan(target, { includePrivate, warningsAsErrors, all });
  if (format === 'json') {
    console.log(JSON.stringify(res, null, 2));
  } else {
    for (const f of res.findings) {
      console.log(`${f.file}:${f.line}: [${f.severity}][${f.category}] ${f.match} (${f.id})`);
    }
    console.log(`${res.fileCount} files scanned. block=${res.blocks.length} warning=${res.warnings.length} -> exit ${res.exitCode}`);
  }
  process.exit(res.exitCode);
}

function cmdAdd(args) {
  const isPublic = args.includes('--public');
  const isPrivate = args.includes('--private');
  if (isPublic === isPrivate) { console.error('add: --public か --private のどちらか一方を指定'); process.exit(2); }
  const category = flagVal(args, '--category') || (isPrivate ? 'customer' : 'pii');
  const severity = flagVal(args, '--severity') || 'block';
  const id = flagVal(args, '--id');
  const reserved = new Set(['--public', '--private', '--category', category, '--severity', severity, '--id', id]);
  const value = args.find((a) => !a.startsWith('--') && !reserved.has(a));
  if (!value) { console.error('add: 登録する値が必要'); process.exit(2); }

  if (isPrivate) {
    const path = join(ROOT, 'ngwords.private.json');
    const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { words: [] };
    data.words = data.words || [];
    if (data.words.some((w) => w.value === value)) { console.log(`既に登録済み: ${value}`); process.exit(0); }
    data.words.push({ value, category, severity });
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
    console.log(`private に登録: ${value} (${category}/${severity})`);
  } else {
    const path = join(ROOT, 'ngwords.public.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.patterns = data.patterns || [];
    const pid = id || `custom-${data.patterns.length + 1}`;
    data.patterns.push({ id: pid, category, regex: value, severity });
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
    console.log(`public に登録: ${pid} -> ${value} (${category}/${severity})`);
  }
  process.exit(0);
}

function cmdList(args) {
  const showPublic = !args.includes('--private');
  const showPrivate = !args.includes('--public');
  if (showPublic) {
    const pub = JSON.parse(readFileSync(join(ROOT, 'ngwords.public.json'), 'utf8'));
    console.log('=== public patterns ===');
    for (const p of pub.patterns || []) console.log(`  [${p.severity}][${p.category}] ${p.id}: ${p.regex}`);
  }
  if (showPrivate) {
    const path = join(ROOT, 'ngwords.private.json');
    console.log('=== private words ===');
    if (existsSync(path)) {
      const priv = JSON.parse(readFileSync(path, 'utf8'));
      for (const w of priv.words || []) console.log(`  [${w.severity}][${w.category}] ${w.value}`);
    } else {
      console.log('  (ngwords.private.json なし)');
    }
  }
  process.exit(0);
}

function cmdMask(args) {
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.error('mask: <path> が必要'); process.exit(2); }
  const write = args.includes('--write');
  const includeWarnings = args.includes('--include-warnings');
  const res = scan(target, {});
  const targets = res.findings.filter((f) => f.severity === 'block' || (includeWarnings && f.severity === 'warning'));
  const byFile = {};
  for (const f of targets) (byFile[f.file] = byFile[f.file] || []).push(f);
  let changed = 0;
  for (const rel of Object.keys(byFile)) {
    const full = join(target, rel);
    let content;
    try { content = readFileSync(full, 'utf8'); } catch { continue; }
    for (const f of byFile[rel]) {
      const ph = PLACEHOLDERS[f.category] || '<redacted>';
      if (content.includes(f.match)) {
        content = content.split(f.match).join(ph);
        changed++;
        console.log(`${rel}:${f.line}: ${f.match} -> ${ph}${write ? '' : ' (dry-run)'}`);
      }
    }
    if (write) writeFileSync(full, content);
  }
  console.log(write ? `マスク適用完了: ${changed}件 (--write)` : `dry-run: ${changed}件が対象（--write で実書換）`);
  process.exit(0);
}

function cmdImport(args) {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('import: <file> が必要 (csv/txt/md)'); process.exit(2); }
  import('./importer.mjs').then(({ importFile }) => {
    const res = importFile(file);
    process.exit(res.exitCode);
  });
}

function cmdExport(args) {
  const format = flagVal(args, '--format') || 'csv';
  const includePublic = args.includes('--public');
  import('./exporter.mjs').then(({ exportWords }) => {
    exportWords(format, includePublic);
    process.exit(0);
  });
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'scan': return cmdScan(rest);
    case 'add': return cmdAdd(rest);
    case 'list': return cmdList(rest);
    case 'mask': return cmdMask(rest);
    case 'import': return cmdImport(rest);
    case 'export': return cmdExport(rest);
    default:
      console.error('使い方: neko-not-yoshi <scan|add|list|mask|import|export> <path|args>');
      console.error('  scan <path> [--format text|json] [--no-private] [--warnings-as-errors]');
      console.error('  add --public <regex> | --private <word> [--category <c>] [--severity block|warning] [--id <id>]');
      console.error('  list [--public|--private]');
      console.error('  mask <path> [--write] [--include-warnings]');
      console.error('  import <file.csv|.txt|.md>  NGワードをバルクインポート');
      console.error('  export [--format csv|txt|md] [--public]  NGワードをエクスポート');
      process.exit(2);
  }
}

main();
