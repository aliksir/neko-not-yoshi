#!/usr/bin/env node
// neko-not-yoshi: 個人情報・顧客名スキャナ（公開前の漏洩チェック / 最後の砦）
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { resolveKey, generateKey, encrypt, decrypt, isEncrypted, getKeyFilePath } from './crypto.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const _scanMod = existsSync(join(ROOT, 'src', 'scanner.mjs'))
  ? await import('./scanner.mjs')
  : await import('../dist/loader.mjs');
const { scan } = _scanMod;

const PLACEHOLDERS = {
  pii: '<redacted-pii>',
  customer: '<redacted>',
  network: 'xxx.xxx.xxx.xxx',
  'local-path': '<redacted-path>',
};

function writeStats(entry) {
  try {
    const dir = process.env.NEKO_HQ_STATS
      ? dirname(process.env.NEKO_HQ_STATS)
      : join(homedir(), '.neko-hq');
    const file = process.env.NEKO_HQ_STATS || join(dir, 'stats.jsonl');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // stats 書き込み失敗は scan 本体に影響させない
  }
}

function flagVal(args, name) {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function cmdScan(args) {
  const startTime = Date.now();
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
  writeStats({
    schema_version: '1.1',
    tool: 'neko-not-yoshi',
    command: 'scan',
    ts: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    exit_code: res.exitCode,
    severity: res.blocks.length > 0 ? 'block' : res.warnings.length > 0 ? 'warn' : 'info',
    summary: {
      findings: res.findings.length,
      blocked: res.blocks.length,
      warned: res.warnings.length,
    },
  });
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

function cmdKeygen(args) {
  const toStdout = args.includes('--stdout');
  generateKey(toStdout);
  if (!toStdout) console.log('鍵を生成しました: ' + getKeyFilePath());
  process.exit(0);
}

function cmdEncrypt(args) {
  const deleteSrc = args.includes('--delete-source');
  const privPath = join(ROOT, 'ngwords.private.json');
  const encPath = join(ROOT, 'ngwords.private.enc.json');
  if (!existsSync(privPath)) { console.error('ngwords.private.json が見つかりません'); process.exit(1); }
  let key = resolveKey();
  if (!key) { console.error('暗号化鍵がありません。keygen で生成してください'); process.exit(1); }
  const plain = readFileSync(privPath, 'utf8');
  writeFileSync(encPath, encrypt(plain, key), 'utf8');
  console.log('暗号化完了: ' + encPath);
  if (deleteSrc) {
    unlinkSync(privPath);
    console.log('平文を削除しました: ' + privPath);
  }
  process.exit(0);
}

function cmdDecrypt(args) {
  const encPath = join(ROOT, 'ngwords.private.enc.json');
  const privPath = join(ROOT, 'ngwords.private.json');
  if (!existsSync(encPath)) { console.error('ngwords.private.enc.json が見つかりません'); process.exit(1); }
  const key = resolveKey();
  if (!key) { console.error('復号鍵がありません'); process.exit(1); }
  const raw = readFileSync(encPath, 'utf8');
  const plain = decrypt(raw, key);
  writeFileSync(privPath, plain, 'utf8');
  console.log('復号完了: ' + privPath);
  process.exit(0);
}

function cmdServe(args) {
  const port = parseInt(flagVal(args, '--port') || '7307', 10);
  import('./server.mjs').then(({ startServer }) => {
    startServer(port);
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
    case 'keygen': return cmdKeygen(rest);
    case 'encrypt': return cmdEncrypt(rest);
    case 'decrypt': return cmdDecrypt(rest);
    case 'serve': return cmdServe(rest);
    default:
      console.error('使い方: neko-not-yoshi <command> <args>');
      console.error('  scan <path> [--format text|json] [--no-private] [--warnings-as-errors]');
      console.error('  add --public <regex> | --private <word> [--category <c>] [--severity block|warning] [--id <id>]');
      console.error('  list [--public|--private]');
      console.error('  mask <path> [--write] [--include-warnings]');
      console.error('  import <file.csv|.txt|.md>  NGワードをバルクインポート');
      console.error('  export [--format csv|txt|md] [--public]  NGワードをエクスポート');
      console.error('  keygen [--stdout]  暗号化鍵を生成');
      console.error('  encrypt [--delete-source]  private辞書を暗号化');
      console.error('  decrypt  暗号化辞書を復号');
      console.error('  serve [--port 7307]  Web UIを起動');
      process.exit(2);
  }
}

main();
