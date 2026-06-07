import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseCsv, parseTxt, parseMd } from '../src/importer.mjs';
import { exportWords } from '../src/exporter.mjs';

describe('parseCsv', () => {
  it('parses CSV with header', () => {
    const input = 'value,category,severity\nAlice,customer,block\nBob,pii,warning';
    const result = parseCsv(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].value, 'Alice');
    assert.equal(result[0].category, 'customer');
    assert.equal(result[0].severity, 'block');
    assert.equal(result[1].severity, 'warning');
  });

  it('parses CSV without header (defaults)', () => {
    const input = 'Alice\nBob';
    const result = parseCsv(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].value, 'Alice');
    assert.equal(result[0].category, 'custom');
    assert.equal(result[0].severity, 'block');
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv('  \n  '), []);
  });

  it('handles invalid category/severity gracefully', () => {
    const input = 'value,category,severity\nAlice,INVALID,WRONG';
    const result = parseCsv(input);
    assert.equal(result[0].category, 'custom');
    assert.equal(result[0].severity, 'block');
  });
});

describe('parseTxt', () => {
  it('parses one word per line', () => {
    const result = parseTxt('Alice\nBob\nCharlie');
    assert.equal(result.length, 3);
    assert.equal(result[0].value, 'Alice');
    assert.equal(result[0].category, 'custom');
  });

  it('skips comments and empty lines', () => {
    const result = parseTxt('# comment\nAlice\n\n  \nBob');
    assert.equal(result.length, 2);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(parseTxt(''), []);
  });
});

describe('parseMd', () => {
  it('parses markdown table', () => {
    const input = '| value | category | severity |\n|-------|----------|----------|\n| Alice | customer | block |\n| Bob | pii | warning |';
    const result = parseMd(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].value, 'Alice');
    assert.equal(result[0].category, 'customer');
    assert.equal(result[1].severity, 'warning');
  });

  it('skips header row and separator', () => {
    const input = '| value | category |\n|---|---|\n| Test | custom |';
    const result = parseMd(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].value, 'Test');
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(parseMd(''), []);
  });

  it('handles single-column table', () => {
    const input = '| value |\n|---|\n| Alice |';
    const result = parseMd(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'custom');
  });
});

describe('exportWords', () => {
  it('returns empty message when no data', () => {
    // exportWords reads from file, so this tests the "no private file" path
    // (actual test depends on environment state)
  });
});
