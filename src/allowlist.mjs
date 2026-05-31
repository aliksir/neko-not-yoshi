// allowlist 判定（false positive 抑制）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 簡易 glob → 正規表現。**/ は任意の深さ（直下含む）、** は任意、* は非スラッシュ。
export function globToRegex(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue; }
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i += 2; continue; }
    if (c === '*') { re += '[^/]*'; i += 1; continue; }
    if (/[A-Za-z0-9_/-]/.test(c)) { re += c; i += 1; continue; }
    re += '\\' + c; i += 1;
  }
  return new RegExp(re + '$');
}

// 公開版 allowlist.json と ローカル専用 allowlist.local.json（.gitignore）をマージ。
// 環境固有の許可（個人 email / ホームパス等）は local 側に置き、公開版には汎用例のみ。
export function loadAllowlist() {
  const result = [];
  for (const fname of ['allowlist.json', 'allowlist.local.json']) {
    const path = join(ROOT, fname);
    if (!existsSync(path)) continue;
    let data;
    try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    for (const a of data.allow || []) {
      result.push({ ...a, _glob: globToRegex(a.pathGlob || '**') });
    }
  }
  return result;
}

// その行に allow.match が含まれ、かつ relPath が pathGlob にマッチすればスキップ対象。
export function isAllowed(allowlist, lineText, relPath) {
  const norm = relPath.split('\\').join('/');
  for (const a of allowlist) {
    if (a.match && lineText.includes(a.match) && a._glob.test(norm)) return a;
  }
  return null;
}
