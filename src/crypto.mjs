import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = join(ROOT, '.neko-keyfile');

export function resolveKey() {
  const rawEnv = process.env.NEKO_ENCRYPT_KEY;
  if (rawEnv) {
    const buf = Buffer.from(rawEnv, 'base64');
    if (buf.length === KEY_LEN) return buf;
  }
  const passEnv = process.env.NEKO_ENCRYPT_PASSPHRASE;
  if (passEnv) {
    const salt = Buffer.alloc(16, 0);
    return scryptSync(passEnv, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  }
  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === KEY_LEN) return buf;
  }
  return null;
}

export function generateKey(stdout = false) {
  const key = randomBytes(KEY_LEN);
  const b64 = key.toString('base64');
  if (stdout) {
    process.stdout.write(b64 + '\n');
    return key;
  }
  writeFileSync(KEY_FILE, b64 + '\n', { encoding: 'utf8', mode: 0o600 });
  return key;
}

export function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: enc.toString('base64'),
  });
}

export function decrypt(json, key) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  if (obj.v !== 1 || obj.alg !== ALG) throw new Error('Unsupported encryption format');
  const iv = Buffer.from(obj.iv, 'base64');
  const tag = Buffer.from(obj.tag, 'base64');
  const ct = Buffer.from(obj.ct, 'base64');
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function isEncrypted(content) {
  try {
    const obj = JSON.parse(content);
    return obj.v === 1 && obj.alg === ALG;
  } catch {
    return false;
  }
}

export function getKeyFilePath() {
  return KEY_FILE;
}
