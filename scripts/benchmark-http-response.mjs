import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { LabHistory } from '@ai-runtime/contracts/http';

// Local microbenchmark only: no HTTP, concurrency, network, database or production RPS.
const record = {
  id: '10000000-0000-4000-8000-000000000001',
  application_id: 'benchmark',
  kind: 'chat',
  valid: true,
  report: {
    valid: true,
    issues: [],
    profile: null,
    capability: 'chat',
    warnings: [],
    contract_version: 'test',
  },
  created_at: '2026-09-24T00:00:00.000Z',
  request_summary: { summary: 'x'.repeat(128) },
  request_digest: 'd'.repeat(64),
  contract_version: 'test',
};
const before = (value) => {
  const result = LabHistory.safeParse(JSON.parse(JSON.stringify(value)));
  if (!result.success) {
    throw new Error('Invalid benchmark fixture');
  }
  return JSON.stringify(result.data);
};
const after = (value) => {
  const result = LabHistory.safeParse(value);
  if (!result.success) {
    throw new Error('Invalid benchmark fixture');
  }
  return JSON.stringify(result.data);
};
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function time(fn, fixture, iterations) {
  const start = performance.now();
  let bytes = 0;
  for (let i = 0; i < iterations; i++) {
    bytes += fn(fixture).length;
  }
  assert.ok(bytes > 0);
  return (performance.now() - start) / iterations;
}
const output = [];
for (const count of [1, 100]) {
  const fixture = {
    items: Array.from({ length: count }, () => ({ ...record })),
    next_cursor: null,
  };
  assert.equal(before(fixture), after(fixture));
  for (let i = 0; i < 100; i++) {
    before(fixture);
    after(fixture);
  }
  const iterations = count === 1 ? 2000 : 200;
  const oldSamples = [];
  const newSamples = [];
  for (let round = 0; round < 9; round++) {
    const order = round % 2 ? ['after', 'before'] : ['before', 'after'];
    for (const name of order) {
      const sample = time(
        name === 'before' ? before : after,
        fixture,
        iterations,
      );
      (name === 'before' ? oldSamples : newSamples).push(sample);
    }
  }
  const beforeMs = median(oldSamples);
  const afterMs = median(newSamples);
  output.push({
    records: count,
    responseBytes: Buffer.byteLength(after(fixture)),
    iterationsPerRound: iterations,
    rounds: 9,
    beforeMedianMs: beforeMs,
    afterMedianMs: afterMs,
    ratio: beforeMs / afterMs,
    beforeSamplesMs: oldSamples,
    afterSamplesMs: newSamples,
  });
}
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      at: new Date().toISOString(),
      scope:
        'single-process warm serialization+validation microbenchmark; not production throughput or GC evidence',
      results: output,
    },
    null,
    2,
  ),
);
