import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyIPv4, looksLikeIPv6, matchPrivateWord, scan } from '../src/scanner.mjs';
import { globToRegex, isAllowed, downgradeFor } from '../src/allowlist.mjs';

function setup() {
  return mkdtempSync(join(tmpdir(), 'nny-'));
}

// ===== classifyIPv4 (C18) =====
test('T15: global IP=false(block), private/loopback=true(warning)', () => {
  assert.equal(classifyIPv4('203.0.113.5'), false);
  assert.equal(classifyIPv4('198.51.100.8'), false);
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
test('T11: ASCII word-boundary (alice != alicer)', () => {
  assert.equal(matchPrivateWord('github.com/alicer/repo', 'alice'), false);
  assert.equal(matchPrivateWord('C:/Users/alice/file', 'alice'), true);
  assert.equal(matchPrivateWord('user alice here', 'alice'), true);
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

test('T1c: noreply@ email is warning (send-only address, non-example domain)', () => {
  const dir = setup();
  writeFileSync(join(dir, 'nr.txt'), 'Co-Authored-By: Claude <noreply@anthropic.com>');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f && f.severity === 'warning');
  rmSync(dir, { recursive: true, force: true });
});

test('T1d: no-reply@ (hyphen) is warning regardless of domain (non-example TLD)', () => {
  const dir = setup();
  // ドメインは example.com 系ではない（.example TLD）→ 降格根拠はローカル部 no-reply のみ＝ドメイン非依存を実証
  writeFileSync(join(dir, 'nr2.txt'), 'sender no-reply@service.example notice');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f && f.severity === 'warning');
  rmSync(dir, { recursive: true, force: true });
});

test('T1e: NOREPLY@ (uppercase) email is warning', () => {
  const dir = setup();
  writeFileSync(join(dir, 'nr3.txt'), 'NOREPLY@anthropic.com sent this');
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
  writeFileSync(join(dir, 'plugin.json'), '{"author":{"email":"maintainer@example.org"}}');
  const res = scan(dir);
  assert.equal(res.findings.find((x) => x.match.includes('maintainer@example.org')), undefined);
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

test('T18: git mode scans UNTRACKED new file (kurouto FIX: backdoor closed)', () => {
  const dir = setup();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // git add していない未追跡の新規ファイルに漏洩を仕込む
  writeFileSync(join(dir, 'notes.md'), 'customer contact foo@realcorp.io secret');
  const res = scan(dir); // git mode（--all なし）
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f && f.severity === 'block', 'untracked new file must be scanned');
  assert.equal(res.exitCode, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('T19: git mode excludes .gitignored file', () => {
  const dir = setup();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), 'ignored.md\n');
  writeFileSync(join(dir, 'ignored.md'), 'leaked@realcorp.io should be ignored');
  const res = scan(dir);
  assert.equal(res.findings.find((x) => x.id === 'email'), undefined, 'gitignored file excluded');
  assert.equal(res.exitCode, 0);
  rmSync(dir, { recursive: true, force: true });
});

// ===== severity 降格機構 (action: downgrade) =====
test('TD1: semgrep-rules 配下の架空攻撃者メールは block→warning に降格（findings 残存）', () => {
  const dir = setup();
  mkdirSync(join(dir, 'semgrep-rules', 'atr'), { recursive: true });
  writeFileSync(join(dir, 'semgrep-rules', 'atr', 'rule.yaml'), 'example: attacker@realcorp.io');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f, 'finding は消去されず残る（FN ゼロ維持）');
  assert.equal(f.severity, 'warning', 'block→warning に降格');
  assert.equal(res.exitCode, 0, 'block ゼロ → exit 0（push 通る）');
  rmSync(dir, { recursive: true, force: true });
});

test('TD2: semgrep-rules 配下のグローバル C2 IP は warning に降格（network）', () => {
  const dir = setup();
  mkdirSync(join(dir, 'semgrep-rules'), { recursive: true });
  writeFileSync(join(dir, 'semgrep-rules', 'c2.yaml'), 'c2_ip: 203.0.113.30');
  const res = scan(dir);
  const f = res.findings.find((x) => x.match === '203.0.113.30');
  assert.ok(f && f.severity === 'warning', 'グローバル IP が warning 降格');
  assert.equal(res.exitCode, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('TD3: downgradeFor — match省略 + pathGlob一致 + category一致で該当（直下/ネスト両方）', () => {
  const al = [{ action: 'downgrade', category: ['pii', 'network'], _glob: globToRegex('**/semgrep-rules/**') }];
  assert.ok(downgradeFor(al, 'any line', 'semgrep-rules/atr/x.yaml', 'pii'));
  assert.ok(downgradeFor(al, 'any line', 'foo/semgrep-rules/y.yaml', 'network'));
});

test('TD4: downgradeFor — pathGlob 外（semgrep-rules 外）は降格対象外（負例・過剰緩和防止）', () => {
  const al = [{ action: 'downgrade', category: ['pii', 'network'], _glob: globToRegex('**/semgrep-rules/**') }];
  assert.equal(downgradeFor(al, 'any line', 'src/config.js', 'pii'), null);
});

test('TD5: downgradeFor — category 不一致（customer/local-path）は降格対象外（負例・不変条件保護）', () => {
  const al = [{ action: 'downgrade', category: ['pii', 'network'], _glob: globToRegex('**/semgrep-rules/**') }];
  assert.equal(downgradeFor(al, 'any line', 'semgrep-rules/atr/x.yaml', 'customer'), null, 'customer は降格されない');
  assert.equal(downgradeFor(al, 'any line', 'semgrep-rules/atr/x.yaml', 'local-path'), null);
});

test('TD6: isAllowed は downgrade エントリを許可扱いしない（finding を消さない）', () => {
  const al = [{ action: 'downgrade', match: 'attacker@realcorp.io', _glob: globToRegex('**/semgrep-rules/**') }];
  assert.equal(isAllowed(al, 'x attacker@realcorp.io', 'semgrep-rules/atr/x.yaml'), null, 'downgrade は isAllowed で null');
});

test('TD7: 後方互換 — semgrep-rules 外の通常パスの攻撃者メールは block 維持（回帰）', () => {
  const dir = setup();
  writeFileSync(join(dir, 'notes.txt'), 'contact attacker@realcorp.io');
  const res = scan(dir);
  const f = res.findings.find((x) => x.id === 'email');
  assert.ok(f && f.severity === 'block', 'semgrep-rules 外は降格されない');
  assert.equal(res.exitCode, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('TD8: downgradeFor — allowlist の category 配列に customer があっても絶対降格しない（三重防御・不変条件）', () => {
  const al = [{ action: 'downgrade', category: ['pii', 'network', 'customer'], _glob: globToRegex('**/semgrep-rules/**') }];
  assert.equal(downgradeFor(al, 'any line', 'semgrep-rules/atr/x.yaml', 'customer'), null, 'category配列に customer があっても関数レベルで降格不可');
  // 同じ allowlist で pii/network は降格する（customer のみ弾く副作用がないことを確認）
  assert.ok(downgradeFor(al, 'any line', 'semgrep-rules/atr/x.yaml', 'pii'));
});
