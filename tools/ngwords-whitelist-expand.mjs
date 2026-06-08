#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const WHITELIST_PATH = 'C:/work/neko-not-yoshi/ngwords-whitelist.json';

const SUFFIX_VARIANTS = {
  'サーバ': ['サーバー', 'Server', 'server', 'srv', 'Srv', 'SRV'],
  'サーバー': ['サーバ', 'Server', 'server', 'srv', 'Srv', 'SRV'],
  'Server': ['server', 'サーバ', 'サーバー', 'srv', 'Srv', 'SRV'],
  'クライアント': ['Client', 'client', 'CLI'],
  'Client': ['client', 'クライアント'],
  'データベース': ['Database', 'database', 'DB', 'db'],
  'Database': ['database', 'データベース', 'DB', 'db'],
  'ネットワーク': ['Network', 'network', 'NW', 'nw'],
  'Network': ['network', 'ネットワーク', 'NW', 'nw'],
  'アプリケーション': ['Application', 'application', 'App', 'app', 'アプリ'],
  'Application': ['application', 'アプリケーション', 'App', 'app', 'アプリ'],
  'ストレージ': ['Storage', 'storage'],
  'Storage': ['storage', 'ストレージ'],
  'セキュリティ': ['Security', 'security', 'Sec', 'sec'],
  'Security': ['security', 'セキュリティ', 'Sec', 'sec'],
  'モニタリング': ['Monitoring', 'monitoring', 'Monitor', 'monitor'],
  'Monitoring': ['monitoring', 'モニタリング'],
  'バックアップ': ['Backup', 'backup', 'BK', 'bk', 'BKP', 'bkp'],
  'Backup': ['backup', 'バックアップ', 'BK', 'bk'],
  'ロードバランサ': ['ロードバランサー', 'LoadBalancer', 'LB', 'lb'],
  'ファイアウォール': ['Firewall', 'firewall', 'FW', 'fw'],
  'Firewall': ['firewall', 'ファイアウォール', 'FW', 'fw'],
  'ゲートウェイ': ['Gateway', 'gateway', 'GW', 'gw'],
  'Gateway': ['gateway', 'ゲートウェイ', 'GW', 'gw'],
  'プロキシ': ['Proxy', 'proxy'],
  'Proxy': ['proxy', 'プロキシ'],
  'インスタンス': ['Instance', 'instance', 'inst'],
  'Instance': ['instance', 'インスタンス', 'inst'],
  'クラスタ': ['クラスター', 'Cluster', 'cluster'],
  'Cluster': ['cluster', 'クラスタ', 'クラスター'],
  'コンテナ': ['Container', 'container'],
  'Container': ['container', 'コンテナ'],
  'レジストリ': ['Registry', 'registry'],
  'Registry': ['registry', 'レジストリ'],
  'リポジトリ': ['Repository', 'repository', 'Repo', 'repo'],
  'Repository': ['repository', 'リポジトリ', 'Repo', 'repo'],
  'エンドポイント': ['Endpoint', 'endpoint', 'EP', 'ep'],
  'Endpoint': ['endpoint', 'エンドポイント', 'EP', 'ep'],
};

const PREFIX_VARIANTS = {
  'DB': ['Database', 'database', 'データベース'],
  'AP': ['App', 'Application', 'アプリ', 'アプリケーション'],
  'NW': ['Network', 'ネットワーク'],
  'FW': ['Firewall', 'ファイアウォール'],
  'LB': ['LoadBalancer', 'ロードバランサ'],
  'WEB': ['Web', 'ウェブ'],
  'Web': ['WEB', 'web', 'ウェブ'],
};

function expandWord(word) {
  const variants = new Set();

  // Case variants
  variants.add(word.toLowerCase());
  variants.add(word.toUpperCase());

  // Suffix replacement
  for (const [suffix, alts] of Object.entries(SUFFIX_VARIANTS)) {
    if (word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      for (const alt of alts) {
        variants.add(base + alt);
      }
    }
  }

  // Prefix replacement
  for (const [prefix, alts] of Object.entries(PREFIX_VARIANTS)) {
    if (word.startsWith(prefix) && word.length > prefix.length) {
      const rest = word.slice(prefix.length);
      for (const alt of alts) {
        variants.add(alt + rest);
      }
    }
  }

  // Hyphen/space/camelCase variants
  if (word.includes(' ')) {
    variants.add(word.replace(/ /g, '-'));
    variants.add(word.replace(/ /g, '_'));
    variants.add(word.replace(/ /g, ''));
  }
  if (word.includes('-')) {
    variants.add(word.replace(/-/g, ' '));
    variants.add(word.replace(/-/g, '_'));
    variants.add(word.replace(/-/g, ''));
  }

  return variants;
}

function main() {
  const data = JSON.parse(readFileSync(WHITELIST_PATH, 'utf8'));
  const original = new Set(data.words);
  const expanded = new Set(data.words);

  let addedCount = 0;
  for (const word of data.words) {
    for (const variant of expandWord(word)) {
      if (!expanded.has(variant)) {
        expanded.add(variant);
        addedCount++;
      }
    }
  }

  data.words = [...expanded].sort();
  data.version = 3;
  data.stats.variants_added = addedCount;
  data.stats.total = expanded.size;
  data.description = 'NGワード抽出時の一般ワードホワイトリスト（表記揺れ拡張済み v3）';

  writeFileSync(WHITELIST_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('元:', original.size);
  console.log('追加:', addedCount);
  console.log('合計:', expanded.size);
}

main();
