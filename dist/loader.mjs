import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as _cryptoMod from '../src/crypto.mjs';

const _require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// key (embedded at build time)
const _k = Buffer.from([0xcc,0x44,0xa4,0x0a,0xf9,0x21,0x56,0xe9,0xb2,0x5e,0x69,0xe9,0xae,0x95,0xb6,0x25,0x17,0xfc,0x0a,0x00,0x4d,0xb1,0xf9,0xcc,0x43,0x93,0xbc,0x38,0x53,0x6e,0xaf,0xac]);

// decrypt
const _enc = JSON.parse(readFileSync(join(__dir, 'core.enc'), 'utf8'));
const _iv = Buffer.from(_enc.iv, 'base64');
const _tag = Buffer.from(_enc.tag, 'base64');
const _ct = Buffer.from(_enc.ct, 'base64');
const _d = createDecipheriv('aes-256-gcm', _k, _iv);
_d.setAuthTag(_tag);
const _src = Buffer.concat([_d.update(_ct), _d.final()]).toString('utf8');

// execute factory
const _fn = new Function('require', 'ROOT', '_crypto', _src);
const _core = _fn(_require, ROOT, _cryptoMod);

// API exports
export const { scan, classifyIPv4, looksLikeIPv6, matchPrivateWord } = _core;
export const { loadNgwords, loadWhitelist } = _core;
export const { loadAllowlist, isAllowed, downgradeFor, globToRegex } = _core;
