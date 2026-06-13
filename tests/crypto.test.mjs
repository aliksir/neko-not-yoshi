import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'src', 'cli.mjs');
const KEY_FILE = join(ROOT, '.neko-keyfile');
const PRIV_FILE = join(ROOT, 'ngwords.private.json');
const ENC_FILE = join(ROOT, 'ngwords.private.enc.json');

const TEST_DATA = {
  version: '1.0',
  words: [
    { value: 'TestCustomer', category: 'customer', severity: 'block' },
    { value: 'secret-project', category: 'custom', severity: 'block' },
  ],
};

function run(args) {
  return execFileSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
}

function cleanup() {
  for (const f of [KEY_FILE, ENC_FILE]) {
    try { unlinkSync(f); } catch { /* ok */ }
  }
}

describe('crypto CLI round-trip', () => {
  let savedPriv = null;

  before(() => {
    cleanup();
    if (existsSync(PRIV_FILE)) {
      savedPriv = readFileSync(PRIV_FILE, 'utf8');
    }
    writeFileSync(PRIV_FILE, JSON.stringify(TEST_DATA, null, 2), 'utf8');
  });

  after(() => {
    cleanup();
    if (savedPriv !== null) {
      writeFileSync(PRIV_FILE, savedPriv, 'utf8');
    } else {
      try { unlinkSync(PRIV_FILE); } catch { /* ok */ }
    }
  });

  it('keygen creates .neko-keyfile', () => {
    run(['keygen']);
    assert.ok(existsSync(KEY_FILE), '.neko-keyfile should exist');
    const key = readFileSync(KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(key, 'base64');
    assert.equal(buf.length, 32, 'key should be 256-bit (32 bytes)');
  });

  it('keygen --stdout outputs key without creating file', () => {
    cleanup();
    const out = run(['keygen', '--stdout']);
    const buf = Buffer.from(out.trim(), 'base64');
    assert.equal(buf.length, 32, 'stdout key should be 256-bit');
    assert.ok(!existsSync(KEY_FILE), '.neko-keyfile should NOT exist with --stdout');
  });

  it('encrypt creates .enc.json', () => {
    run(['keygen']);
    run(['encrypt']);
    assert.ok(existsSync(ENC_FILE), 'encrypted file should exist');
    const enc = JSON.parse(readFileSync(ENC_FILE, 'utf8'));
    assert.equal(enc.v, 1, 'format version should be 1');
    assert.equal(enc.alg, 'aes-256-gcm', 'algorithm should be aes-256-gcm');
    assert.ok(enc.iv, 'should have IV');
    assert.ok(enc.ct, 'should have ciphertext');
    assert.ok(enc.tag, 'should have auth tag');
  });

  it('encrypt --delete-source removes plaintext', () => {
    writeFileSync(PRIV_FILE, JSON.stringify(TEST_DATA, null, 2), 'utf8');
    run(['encrypt', '--delete-source']);
    assert.ok(!existsSync(PRIV_FILE), 'plaintext should be deleted');
    assert.ok(existsSync(ENC_FILE), 'encrypted file should exist');
  });

  it('decrypt restores original data', () => {
    run(['decrypt']);
    assert.ok(existsSync(PRIV_FILE), 'plaintext should be restored');
    const restored = JSON.parse(readFileSync(PRIV_FILE, 'utf8'));
    assert.equal(restored.words.length, TEST_DATA.words.length);
    assert.equal(restored.words[0].value, TEST_DATA.words[0].value);
    assert.equal(restored.words[1].value, TEST_DATA.words[1].value);
  });

  it('full round-trip: keygen -> encrypt --delete-source -> decrypt preserves data', () => {
    cleanup();
    writeFileSync(PRIV_FILE, JSON.stringify(TEST_DATA, null, 2), 'utf8');

    run(['keygen']);
    run(['encrypt', '--delete-source']);
    assert.ok(!existsSync(PRIV_FILE), 'plaintext deleted after encrypt');

    run(['decrypt']);
    const restored = JSON.parse(readFileSync(PRIV_FILE, 'utf8'));
    assert.deepEqual(restored, TEST_DATA, 'data should survive full round-trip');
  });
});

describe('transparent decryption in scan', () => {
  let savedPriv = null;

  before(() => {
    cleanup();
    if (existsSync(PRIV_FILE)) {
      savedPriv = readFileSync(PRIV_FILE, 'utf8');
    }
    writeFileSync(PRIV_FILE, JSON.stringify(TEST_DATA, null, 2), 'utf8');
    run(['keygen']);
    run(['encrypt', '--delete-source']);
  });

  after(() => {
    cleanup();
    if (savedPriv !== null) {
      writeFileSync(PRIV_FILE, savedPriv, 'utf8');
    } else {
      try { unlinkSync(PRIV_FILE); } catch { /* ok */ }
    }
  });

  it('scan loads encrypted dictionary without manual decrypt', () => {
    assert.ok(!existsSync(PRIV_FILE), 'plaintext should not exist');
    assert.ok(existsSync(ENC_FILE), 'encrypted file should exist');

    const testDir = join(ROOT, 'tests', 'fixtures');
    const out = run(['scan', testDir, '--format', 'json']);
    const result = JSON.parse(out);
    assert.ok(Array.isArray(result.findings), 'scan should complete and return findings array');
  });
});
