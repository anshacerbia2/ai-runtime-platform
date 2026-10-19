import {
  FileRunscLaunchStore,
  type FileRunscLaunchStoreOptions,
} from '../../src/file-runsc-launch-store.js';
import type { RunscLaunchRecord } from '../../src/runsc-sandbox-driver.js';

process.on(
  'message',
  async (input: {
    options: FileRunscLaunchStoreOptions;
    record: RunscLaunchRecord;
    digest: string;
  }) => {
    const store = await FileRunscLaunchStore.open(input.options);
    await store.reserve(input.record, input.digest);
    // Reservation ack is after file+directory fsync; this fixture never launches.
    process.send?.({ state: 'RESERVED', sandboxId: input.record.sandboxId });
  },
);
