import assert from 'node:assert/strict';
import { arch, platform, release } from 'node:os';
import { assertProbeHost } from './gvisor-profile.mjs';

assertProbeHost({
  platform: platform(),
  arch: arch(),
  release: release(),
  uid: process.geteuid?.(),
  disposable: process.argv[2] === '--disposable-linux-host',
});
const { FileRunscLaunchStore } =
  await import('../../apps/runner/dist/file-runsc-launch-store.js');
const { FileRunscBundleProducer } =
  await import('../../apps/runner/dist/file-runsc-bundle-producer.js');
const { RunscProcessClient } =
  await import('../../apps/runner/dist/runsc-process-client.js');
const { runscBindingAnnotation } =
  await import('../../apps/runner/dist/runsc-sandbox-driver.js');
process.once('message', (input) => {
  void (async () => {
    // Parent-only inert fixture configuration, not an application transport.
    const store = await FileRunscLaunchStore.open(input.storeOptions);
    const producer = await FileRunscBundleProducer.open(input.producerOptions);
    const client = await RunscProcessClient.open(input.processOptions);
    await producer.prepare(input.identity, 'forced');
    const verified = await producer.verify(input.identity, 'forced');
    const saved = await store.reserve(verified.record, verified.configDigest);
    assert.equal(saved.fresh, true);
    const monitor = client.run(verified.record);
    let ended = false;
    void monitor.finished.then(() => {
      ended = true;
    });
    const deadline = performance.now() + 5000;
    while (true) {
      assert.ok(
        !ended && performance.now() < deadline,
        'Owned fixture failed before live crash barrier.',
      );
      const rows = await client.list();
      if (
        rows.some(
          (row) =>
            row.id === verified.record.sandboxId && row.status === 'running',
        )
      ) {
        const state = await client.readState(verified.record);
        assert.equal(state.id, verified.record.sandboxId);
        assert.equal(state.bundle, verified.record.bundle);
        assert.equal(state.status, 'running');
        assert.equal(
          state.annotations?.[runscBindingAnnotation],
          JSON.stringify(verified.record.identity),
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    process.send({
      state: 'RUNNING',
      sandboxId: verified.record.sandboxId,
      configDigest: verified.configDigest,
    });
    // Intentionally no close/unlock: the parent SIGKILLs this owner while its
    // attached runsc monitor and sandbox are live. The store lock stays durable.
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
    process.disconnect();
  });
});
