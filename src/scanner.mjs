// 走査エンジン: ファイル列挙 + パターン/語マッチ + IP範囲判定 + allowlist フィルタ
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, extname } from 'node:path';
import { loadNgwords } from './ngwords.mjs';
import { loadAllowlist, isAllowed, downgradeFor } from './allowlist.mjs';

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '_deleted', '_archive', '.pytest_cache']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.tar',
  '.exe', '.dll', '.bin', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.db', '.wasm',
]);

function walk(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(full, files);
    } else if (e.isFile()) {
      if (BINARY_EXT.has(extname(e.name).toLowerCase())) continue;
      files.push(full);
    }
  }
  return files;
}

// git 管理リポなら「追跡ファイル + ignore対象外の未追跡ファイル」を取得。
// --cached(追跡) + --others(未追跡) + --exclude-standard(.gitignore除外)。
// .gitignore 済みのローカル生成物（nightly 実行ログ等）のみ除外し、git add 前の未追跡の
// 新規ファイルは漏洩チェック対象に含める（最後の砦の裏口=untracked漏れ を塞ぐ、kurouto指摘）。
function gitScannableFiles(dir) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    const rels = out.split('\n').filter(Boolean);
    return rels.length ? rels.map((r) => join(dir, r)) : null;
  } catch {
    return null;
  }
}

// バイナリ判定: 先頭8000文字に NUL 文字(charCode 0)があればバイナリとみなす
function looksBinary(content) {
  const head = content.slice(0, 8000);
  for (let i = 0; i < head.length; i++) {
    if (head.charCodeAt(i) === 0) return true;
  }
  return false;
}

// IPv4 オクテット判定。'invalid'=各オクテット>255でIPでない（バージョン番号等）
// true=private/loopback/reserved/subnet-mask（warning降格）/ false=global（block）
export function classifyIPv4(ip) {
  const o = ip.split('.').map((n) => Number(n));
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'invalid';
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  if (o[0] === 127) return true;
  if (o[0] === 0) return true;
  if (o[0] === 169 && o[1] === 254) return true;
  if (o[0] === 255) return true;
  return false;
}

// IPv6 らしさ判定: :: 短縮形 or 6+グループかつ hex/3桁含む。
// 時刻 HH:MM:SS（3グループ各2桁）・票数 1:1:1（3グループ各1桁）等の誤検出を除外。
export function looksLikeIPv6(s) {
  if (s.includes('::')) return true;
  const g = s.split(':');
  if (g.length < 6) return false;
  return g.some((x) => x.length >= 3 || /[a-fA-F]/.test(x));
}

function isAsciiWord(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

// ASCII語は語境界マッチ（alice が alicer に誤マッチしない）、非ASCIIは includes
export function matchPrivateWord(line, word) {
  if (isAsciiWord(word)) {
    const esc = word.replace(/[^A-Za-z0-9_]/g, (c) => '\\' + c);
    return new RegExp('\\b' + esc + '\\b').test(line);
  }
  return line.includes(word);
}

function safeRegex(src) {
  try { return new RegExp(src, 'g'); } catch { return null; }
}

export function scan(targetDir, opts = {}) {
  const { includePrivate = true, warningsAsErrors = false } = opts;
  const { patterns, words } = loadNgwords({ includePrivate });
  const allowlist = loadAllowlist();
  const compiled = patterns.map((p) => ({ ...p, _re: safeRegex(p.regex) })).filter((p) => p._re);
  // デフォルト: git 追跡 + ignore対象外の未追跡（=コミットされうる対象）。--all で .gitignore 済みも含め全走査。
  const files = opts.all ? walk(targetDir) : (gitScannableFiles(targetDir) || walk(targetDir));
  const findings = [];

  for (const file of files) {
    const rel = relative(targetDir, file).split('\\').join('/');
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    if (looksBinary(content)) continue;
    const lines = content.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      for (const p of compiled) {
        p._re.lastIndex = 0;
        let m;
        while ((m = p._re.exec(line)) !== null) {
          let severity = p.severity;
          const matchText = m[0];
          if (p.id === 'ipv4') {
            const cls = classifyIPv4(matchText);
            if (cls === 'invalid') { if (m.index === p._re.lastIndex) p._re.lastIndex++; continue; }
            if (cls === true) severity = 'warning';
          }
          if (p.id === 'ipv6' && !looksLikeIPv6(matchText)) {
            if (m.index === p._re.lastIndex) p._re.lastIndex++;
            continue;
          }
          if (p.id === 'email') {
            const local = (matchText.split('@')[0] || '').toLowerCase();
            const d = (matchText.split('@')[1] || '').toLowerCase();
            if (d === 'example.com' || d === 'example.org' || d === 'example.net') severity = 'warning';
            // noreply/no-reply は送信専用アドレスで個人非特定 → warning 降格（DISCRETION-001: 検出網を狭める変更、安易に削除しない）
            if (local === 'noreply' || local === 'no-reply') severity = 'warning';
          }
          if (!isAllowed(allowlist, line, rel)) {
            // severity は上記の ipv4/email 降格を適用済みの値。block かつ降格ルール該当なら warning へ降格。
            // 顧客名(customer)は private 語ループでのみ検出され、そのループは降格処理を持たない（構造除外）。
            // 下の p.category!=='customer' は現状の public パターンでは到達しないが、将来 customer 種別の
            // public パターンが追加された場合の保険（fail-safe、downgradeFor 内ガードと合わせた多層防御）。
            let sev = severity;
            if (sev === 'block' && p.category !== 'customer' && downgradeFor(allowlist, line, rel, p.category)) {
              sev = 'warning';
            }
            findings.push({ file: rel, line: idx + 1, severity: sev, category: p.category, match: matchText, id: p.id });
          }
          if (m.index === p._re.lastIndex) p._re.lastIndex++;
        }
      }
      for (const w of words) {
        if (!matchPrivateWord(line, w.value)) continue;
        if (isAllowed(allowlist, line, rel)) continue;
        findings.push({ file: rel, line: idx + 1, severity: w.severity || 'block', category: w.category || 'customer', match: w.value, id: 'private' });
      }
    }
  }

  const blocks = findings.filter((f) => f.severity === 'block');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const exitCode = blocks.length > 0 || (warningsAsErrors && warnings.length > 0) ? 1 : 0;
  return { findings, blocks, warnings, exitCode, fileCount: files.length };
}
