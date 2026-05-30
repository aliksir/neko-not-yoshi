// NGワードリスト読込（public 正規表現 + private 顧客名）
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// public パターンと private 語を読み込んで返す。
// private は ngwords.private.json（.gitignore 対象）が存在する場合のみ読む。
// example のプレースホルダ（<...>）は除外する。
export function loadNgwords({ includePrivate = true } = {}) {
  const pub = JSON.parse(readFileSync(join(ROOT, 'ngwords.public.json'), 'utf8'));
  const patterns = (pub.patterns || []).map((p) => ({ ...p, source: 'public' }));

  const words = [];
  if (includePrivate) {
    const privPath = join(ROOT, 'ngwords.private.json');
    if (existsSync(privPath)) {
      const priv = JSON.parse(readFileSync(privPath, 'utf8'));
      for (const w of priv.words || []) {
        if (typeof w.value === 'string' && w.value && !w.value.startsWith('<')) {
          words.push({ ...w, source: 'private' });
        }
      }
    }
  }
  return { patterns, words };
}
