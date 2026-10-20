import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  RunscCgroupInspector,
  cgroupEventsEmpty,
  cgroupProcsEmpty,
} from '../src/runsc-cgroup-inspector.js';

const binding = () => ({
  assignmentId: randomUUID(),
  executionId: randomUUID(),
  attemptId: randomUUID(),
  runnerId: 'runner',
  ownerSubject: 'owner',
  bootId: randomUUID(),
  generation: 1,
  epoch: 1,
});
const bytes = (text: string) => Buffer.from(text);

test('kernel population is hierarchical; an empty parent PID list cannot hide a populated descendant', () => {
  assert.equal(cgroupProcsEmpty(bytes('')), true);
  assert.equal(cgroupEventsEmpty(bytes('populated 1\nfrozen 0\n')), false);
  assert.equal(cgroupEventsEmpty(bytes('populated 0\nfrozen 1\n')), true);
  assert.equal(cgroupEventsEmpty(bytes('frozen 0\npopulated 0\n')), true);
  assert.equal(cgroupEventsEmpty(bytes('populated 0\n')), true);
});

test('malformed, duplicate, missing, unknown and oversized kernel events never become empty evidence', () => {
  for (const text of [
    '',
    'frozen 0\n',
    'populated 2\n',
    'populated 00\n',
    'populated 0',
    'populated 0\npopulated 1\n',
    'populated 0\nfrozen 0\nfrozen 1\n',
    'populated 0\nfuture 0\n',
    'populated 0\n\n',
    'populated 0\r\n',
    'x'.repeat(1025),
  ]) {
    assert.throws(() => cgroupEventsEmpty(bytes(text)), /unavailable/);
  }
  assert.throws(() => cgroupEventsEmpty(Buffer.from([0xff])));
});

test('bounded PID lists accept kernel duplicates but reject invalid or truncated data', () => {
  assert.equal(cgroupProcsEmpty(bytes('8\n8\n13\n')), false);
  for (const text of [
    '0\n',
    '-1\n',
    '42',
    '1\n\n',
    '01\n',
    '2147483648\n',
    '1\r\n',
    ' 1\n',
    'x'.repeat(65537),
  ]) {
    assert.throws(() => cgroupProcsEmpty(bytes(text)), /unavailable/);
  }
  assert.throws(() => cgroupProcsEmpty(Buffer.from([0xff])));
});

test(
  'unsupported hosts refuse before filesystem access',
  { skip: process.platform === 'linux' },
  async () => {
    await assert.rejects(RunscCgroupInspector.open(), /unavailable/);
  },
);

test(
  'native read validates cgroup2 and scopes absence to a deterministic fresh assignment',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const inspector = await RunscCgroupInspector.open();
    t.after(() => inspector.close());
    assert.equal(await inspector.empty(binding()), true);
    await assert.rejects(
      inspector.empty({
        ...binding(),
        assignmentId: '../../outside',
        epoch: 0,
      }),
    );
    assert.equal(inspector.recoveryRequired, false);
    await inspector.close();
    await assert.rejects(inspector.empty(binding()));
  },
);

test(
  'inspection intake is bounded and close drains only already accepted queries',
  { skip: process.platform !== 'linux' },
  async () => {
    const inspector = await RunscCgroupInspector.open();
    const accepted = Array.from({ length: 4 }, () =>
      inspector.empty(binding()),
    );
    await assert.rejects(inspector.empty(binding()));
    const closing = inspector.close();
    await assert.rejects(inspector.empty(binding()));
    assert.deepEqual(await Promise.all(accepted), [true, true, true, true]);
    await closing;
  },
);
