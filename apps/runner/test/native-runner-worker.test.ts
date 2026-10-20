import assert from 'node:assert/strict';
import test from 'node:test';
import { openNativeRunnerWorker } from '../src/native-runner-worker.js';

test('native runner rejects unsupported platforms and excess monitor capacity without activation', async () => {
  for (const capacity of [0, 9, 1.5]) {
    await assert.rejects(
      openNativeRunnerWorker(null as never, { capacity } as never),
      /capacity/,
    );
  }
  if (process.platform !== 'linux') {
    await assert.rejects(
      openNativeRunnerWorker(null as never, { capacity: 1 } as never),
      /unavailable/,
    );
  }
});
