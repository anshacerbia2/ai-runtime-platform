import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProbeProcessStat } from '../lib/gvisor-owner-process.mjs';

test('probe proc identity handles parenthesized command names and binds PID/parent/group/start ticks', () => {
  const fields = [
    'S',
    '40',
    '41',
    ...Array(16).fill('0'),
    '98765432101234567890',
  ];
  const value = parseProbeProcessStat(
    `42 (name ) with spaces) ${fields.join(' ')}\n`,
  );
  assert.deepEqual(value, {
    pid: 42,
    parent: 40,
    group: 41,
    state: 'S',
    startTicks: '98765432101234567890',
  });
  assert.ok(Object.isFrozen(value));
});

test('malformed or oversize probe proc data cannot identify an owned monitor', () => {
  for (const text of [
    '',
    '42 broken',
    '42 (name) S 4 5',
    'x'.repeat(8193),
    '0 (name) S 1 2',
    `42 (name) S nope 4 ${Array(17).fill('0').join(' ')}`,
  ]) {
    assert.throws(() => parseProbeProcessStat(text));
  }
});
