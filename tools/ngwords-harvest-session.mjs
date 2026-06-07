#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MAPS_DIR = join(homedir(), '.pii-mask-yoshi', 'maps');
const NGWORDS_PATH = join(process.env.NEKO_NOT_YOSHI_DIR || 'C:/work/neko-not-yoshi', 'ngwords.private.json');

const TOKEN_RE = /^\[([A-Z-]+)-\d{3}\]$/;

const PREFIX_TO_CATEGORY = {
  'PERSON': 'customer',
  'PRIV-IPv4': 'network',
  'IPv4': 'network',
  'IPv6': 'network',
  'EMAIL': 'pii',
  'TEL': 'pii',
  'ADDR': 'pii',
  'PASSWD': 'credential',
  'SECRET': 'credential',
  'APIKEY': 'credential',
  'JWT': 'credential',
  'CARD': 'financial',
  'BANK': 'financial',
  'MYNUM': 'pii',
  'PASSPORT': 'pii',
  'CORPNUM': 'pii',
  'CUSTOMER': 'customer',
  'NAME': 'customer',
  'PATH': 'local-path',
};

function findLatestSessionMap() {
  let files;
  try {
    files = readdirSync(MAPS_DIR).filter(f => f.startsWith('session-') && f.endsWith('.json'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  let best = null;
  let bestSize = 0;
  let bestMtime = 0;

  for (const f of files) {
    const full = join(MAPS_DIR, f);
    const st = statSync(full);
    if (st.size > 2 && st.mtimeMs > bestMtime) {
      bestMtime = st.mtimeMs;
      bestSize = st.size;
      best = full;
    }
  }
  return best;
}

function splitPersonList(value) {
  if (/[、,]/.test(value)) {
    return value.split(/[、,]/).map(s => s.trim()).filter(s => s.length > 0);
  }
  return [value];
}

function loadNgwords() {
  try {
    return JSON.parse(readFileSync(NGWORDS_PATH, 'utf8'));
  } catch {
    return { words: [] };
  }
}

function extractFromFilePaths(paths) {
  const extracted = new Map();
  for (const p of paths) {
    const parts = p.replace(/\\/g, '/').split('/');
    for (const part of parts) {
      const name = part.replace(/\.[^.]+$/, '');
      if (name.length < 3) continue;
      if (/^[a-zA-Z]:$/.test(name)) continue;
      if (/^(work|Users|依頼事項|R|test|src|node_modules|\d{8})$/i.test(name)) continue;
      const cleaned = name.replace(/^【|】$/g, '').replace(/【/g, '\n').replace(/】/g, '\n');
      for (const frag of cleaned.split('\n')) {
        const trimmed = frag.trim();
        if (trimmed.length >= 3 && /[　-鿿]/.test(trimmed)) {
          extracted.set(trimmed, 'infra');
        }
      }
    }
  }
  return extracted;
}

function run() {
  const args = process.argv.slice(2);
  const applyMode = args.includes('--apply');
  const filePathArgs = [];
  const manualArgs = [];
  let collectFiles = false;

  for (const a of args) {
    if (a === '--apply') continue;
    if (a === '--files') { collectFiles = true; continue; }
    if (collectFiles && (a.includes('/') || a.includes('\\'))) {
      filePathArgs.push(a);
    } else {
      collectFiles = false;
      manualArgs.push(a);
    }
  }

  const mapPath = findLatestSessionMap();
  const sessionItems = new Map();

  if (mapPath) {
    const data = JSON.parse(readFileSync(mapPath, 'utf8'));
    for (const [token, original] of Object.entries(data)) {
      const m = TOKEN_RE.exec(token);
      if (!m) continue;
      const prefix = m[1];
      const cat = PREFIX_TO_CATEGORY[prefix] || 'customer';

      if (prefix === 'PERSON') {
        for (const name of splitPersonList(original)) {
          sessionItems.set(name, cat);
        }
      } else if (prefix === 'PATH') {
        continue;
      } else {
        sessionItems.set(original, cat);
      }
    }
  }

  for (const [value, cat] of extractFromFilePaths(filePathArgs)) {
    if (!sessionItems.has(value)) sessionItems.set(value, cat);
  }

  for (const item of manualArgs) {
    if (!sessionItems.has(item)) {
      sessionItems.set(item, 'infra');
    }
  }

  if (sessionItems.size === 0) {
    console.log('候補なし（セッションマップが空 or 未検出）');
    process.exit(0);
  }

  const ngwords = loadNgwords();
  const existingValues = new Set(ngwords.words.map(w => w.value));

  const candidates = [];
  for (const [value, category] of sessionItems) {
    if (!existingValues.has(value)) {
      candidates.push({ value, category, severity: 'block' });
    }
  }

  if (candidates.length === 0) {
    console.log('全て登録済み（追加候補なし）');
    process.exit(0);
  }

  const grouped = {};
  for (const c of candidates) {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  }

  console.log(`=== ngwords 追加候補: ${candidates.length}件 ===`);
  for (const [cat, items] of Object.entries(grouped).sort()) {
    console.log(`\n[${cat}] ${items.length}件:`);
    for (const item of items) {
      console.log(`  + "${item.value}"`);
    }
  }

  if (applyMode) {
    ngwords.words.push(...candidates);
    ngwords._generated = `${ngwords._generated} + harvest-session ${new Date().toISOString().slice(0, 10)} (${candidates.length}件追加)`;
    writeFileSync(NGWORDS_PATH, JSON.stringify(ngwords, null, 2) + '\n', 'utf8');
    console.log(`\n✅ ${candidates.length}件を ngwords.private.json に追加しました`);
  } else {
    console.log(`\n適用するには: node tools/ngwords-harvest-session.mjs --apply`);
    console.log('手動追加: node tools/ngwords-harvest-session.mjs システム名1 システム名2 --apply');
  }
}

run();
