import { test } from 'node:test';
import assert from 'node:assert';
import { mergeVerdicts } from '../tools/ngwords-llm-crosscheck.mjs';

const candidates = [
  { value: 'test-word', category: 'customer', severity: 'block' },
];

test('both models keep=true -> consensus=keep, confidence=unanimous', () => {
  const verdicts = { 'model-a': { 0: true }, 'model-b': { 0: true } };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'unanimous');
});

test('both models keep=false -> consensus=remove, confidence=unanimous', () => {
  const verdicts = { 'model-a': { 0: false }, 'model-b': { 0: false } };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'remove');
  assert.equal(result[0].confidence, 'unanimous');
});

test('1:1 split -> consensus=keep (FN-zero), confidence=split', () => {
  const verdicts = { 'model-a': { 0: true }, 'model-b': { 0: false } };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'split');
});

test('one model null (error) + other keep=true -> consensus=keep, confidence=degraded', () => {
  const verdicts = { 'model-a': { 0: null }, 'model-b': { 0: true } };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'degraded');
  assert.equal(result[0].verdicts['model-a'], null);
});

test('one model null + other keep=false -> consensus=keep (null=keep, FN-zero)', () => {
  const verdicts = { 'model-a': { 0: null }, 'model-b': { 0: false } };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'degraded');
});

test('both models null -> consensus=keep (failsafe), confidence=no-data', () => {
  const verdicts = { 'model-a': { 0: null }, 'model-b': { 0: null } };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'no-data');
});

test('missing index defaults to null -> keep, confidence=no-data', () => {
  const verdicts = { 'model-a': {}, 'model-b': {} };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'no-data');
});

test('preserves original candidate fields', () => {
  const withExtra = [{ value: 'x', category: 'pii', severity: 'block', keep: true, reason: 'test' }];
  const verdicts = { 'model-a': { 0: true }, 'model-b': { 0: false } };
  const result = mergeVerdicts(withExtra, verdicts);
  assert.equal(result[0].value, 'x');
  assert.equal(result[0].keep, true);
  assert.equal(result[0].reason, 'test');
  assert.ok(result[0].verdicts);
  assert.ok(result[0].consensus);
});

test('multiple candidates processed correctly', () => {
  const multi = [
    { value: 'a', category: 'pii', severity: 'block' },
    { value: 'b', category: 'customer', severity: 'block' },
    { value: 'c', category: 'network', severity: 'block' },
  ];
  const verdicts = {
    'model-a': { 0: true, 1: false, 2: true },
    'model-b': { 0: true, 1: false, 2: false },
  };
  const result = mergeVerdicts(multi, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'unanimous');
  assert.equal(result[1].consensus, 'remove');
  assert.equal(result[1].confidence, 'unanimous');
  assert.equal(result[2].consensus, 'keep');
  assert.equal(result[2].confidence, 'split');
});

test('three models: majority vote', () => {
  const verdicts = {
    'model-a': { 0: true },
    'model-b': { 0: false },
    'model-c': { 0: false },
  };
  const result = mergeVerdicts(candidates, verdicts);
  assert.equal(result[0].consensus, 'keep');
  assert.equal(result[0].confidence, 'split');
});
