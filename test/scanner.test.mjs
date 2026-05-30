import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyIPv4, looksLikeIPv6, matchPrivateWord, scan } from '../src/scanner.mjs';
import { globToRegex } from '../src/allowlist.mjs';

function setup() {
  return mkdtempSync(join(tmpdir(), 'nny-'));
}

// ===== classifyIPv4 (C18) =====
test('T15: global IP=false(block), private/loopback=true(warning)', () => {
  assert.equal(classifyIPv4('203.0.113.5'), false);
  assert.equal(classifyIPv4('8.8.8.8'), false);
  assert.equal(classifyIPv4('192.168.1.1'), true);
  assert.equal(classifyIPv4('10.0.0.1'), true);
  assert.equal(classifyIPv4('172.16.5.4'), true);
  assert.equal(classifyIPv4('127.0.0.1'), true);
});

test('T16: subnet mask 255.x=true(not block), octet>255 or <4octet=invalid', () => {
  assert.equal(classifyIPv4('255.255.255.0'), true);
  assert.equal(classifyIPv4('256.1.1.1'), 'invalid');
  assert.equal(classifyIPv4('1.2.3'), 'invalid');
  assert.equal(classifyIPv4('999.999.999.999'), 'invalid');
});

test('T16b: IPv6 excludes time HH:MM:SS and score 1:1:1, keeps real IPv6', () => {
  assert.equal(looksLikeIPv6('14:30:18'), false);
  assert.equal(looksLikeIPv6('1:1:1'), false);
  assert.equal(looksLikeIPv6('22:00:02'), false);
  assert.equal(looksLikeIPv6('fe80::1'), true);
  assert.equal(looksLikeIPv6('2001:db8:0:0:0:0:0:1'), true);
});

// ===== matchPrivateWord (C11, FIX-2) =====
test('T11: ASCII word-boundary (aliks != aliksir)', () => {
  assert.equal(matchPrivateWord('github.com/aliksir/repo', 'aliks'), false);
  assert.equal(matchPrivateWord('C:/Users/aliks/file', 'aliks'), true);
  assert.equal(matchPrivateWord('user aliks here', 'aliks'), true);
});

test('private non-ASCII (Japanese) uses includes', () => {
  assert.equal(matchPrivateWord('担当は顧客名株式会社です', '顧客名'), true);
  assert.equal(matchPrivateWord('no match here', '顧客名'), false);
});

// ===== globToRegex (allowlist pathGlob, T12/T14) =====
test('T12/T14: pathGlob **/X matches nested and top, not others', () => {
  const cl = globToRegex('**/CHANGELOG.md');
  assert.ok(cl.test('multi-agent-neko/CHANGELOG.md'));
  assert.ok(cl.test('CHANGELOG.md'));
  assert.ok(!cl.test('docs/OTHER.md'));
  const nr = globToRegex('**/nightly-runner.mjs');
  assert.ok(nr.test('scripts/nightly-runner.mjs'));
  assert.ok(!nr.test('scripts/other.mjs'));
  assert.ok(globToRegex('**').test('any/deep/path'));
});

// ===== scan integration =====
test('T1: email detected as block, exit 1', () => {
  const dir = setup();
  writeFileSync(join(dir, 'a.txt'), 'contact foo@realcorp.io please');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f && f.severity === 'block');
  assert.equal(res.exitCode, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('T1b: example.com email is warning (RFC2606 sample domain)', () => {
  const dir = setup();
  writeFileSync(join(dir, 'x.txt'), 'sample user@example.com here');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f && f.severity === 'warning');
  rmSync(dir, { recursive: true, force: true });
});

test('T13: new home path C:/Users/<other> is block', () => {
  const dir = setup();
  writeFileSync(join(dir, 'b.txt'), 'path C:/Users/bob/secret.json here');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'local-path-home');
  assert.ok(f && f.severity === 'block');
  rmSync(dir, { recursive: true, force: true });
});

test('T3: C:/work is warning, exit 0', () => {
  const dir = setup();
  writeFileSync(join(dir, 'c.txt'), 'see C:/work/checklist/ here');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'local-path-work');
  assert.ok(f && f.severity === 'warning');
  assert.equal(res.exitCode, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('T15-int: global IP block, private IP warning', () => {
  const dir = setup();
  writeFileSync(join(dir, 'd.txt'), 'server 203.0.113.5 gw 192.168.1.1');
  const res = scan(dir);
  assert.equal(res.findings.find((x) => x.match === '203.0.113.5').severity, 'block');
  assert.equal(res.findings.find((x) => x.match === '192.168.1.1').severity, 'warning');
  rmSync(dir, { recursive: true, force: true });
});

test('T16-int: 255.255.255.0 not block (warning)', () => {
  const dir = setup();
  writeFileSync(join(dir, 'e.txt'), 'netmask 255.255.255.0 here');
  const res = scan(dir);
  const f = res.findings.find((x) => x.match === '255.255.255.0');
  assert.ok(f && f.severity === 'warning');
  assert.equal(res.blocks.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('T5: author email in plugin.json allowed via allowlist', () => {
  const dir = setup();
  writeFileSync(join(dir, 'plugin.json'), '{"author":{"email":"hide.kiyohara@gmail.com"}}');
  const res = scan(dir);
  assert.equal(res.findings.find((x) => x.match.includes('hide.kiyohara')), undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('T6: clean dir exit 0', () => {
  const dir = setup();
  writeFileSync(join(dir, 'clean.txt'), 'just normal code here');
  const res = scan(dir);
  assert.equal(res.blocks.length, 0);
  assert.equal(res.exitCode, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('T8: _deleted excluded from scan', () => {
  const dir = setup();
  mkdirSync(join(dir, '_deleted'));
  writeFileSync(join(dir, '_deleted', 'old.txt'), 'leaked@example.com');
  const res = scan(dir);
  assert.equal(res.findings.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('T7: warningsAsErrors makes warning exit 1', () => {
  const dir = setup();
  writeFileSync(join(dir, 'w.txt'), 'see C:/work/here');
  const res = scan(dir, { warningsAsErrors: true });
  assert.equal(res.exitCode, 1);
  rmSync(dir, { recursive: true, force: true });
});
