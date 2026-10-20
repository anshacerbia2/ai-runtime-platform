import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeRunscHost } from '../src/native-runsc-host.js';
import { FileRunscLaunchStore } from '../src/file-runsc-launch-store.js';
import { runscSandboxId } from '../src/runsc-sandbox-driver.js';

test(
  'native host rejects unsupported platforms before touching configuration or filesystem',
  { skip: process.platform === 'linux' },
  async () => {
    await assert.rejects(NativeRunscHost.open(null as never), /unavailable/);
  },
);

test(
  'failed startup and recovered records retain the layout lock before any runtime is opened',
  { skip: process.platform !== 'linux' },
  async (t) => {
    for (const recovered of [false, true]) {
      const root = await mkdtemp(join(await realpath(tmpdir()), 'runsc-host-'));
      await chmod(root, 0o700);
      t.after(() => rm(root, { recursive: true, force: true }));
      const directory = join(root, 'owner');
      await mkdir(directory, { mode: 0o700 });
      for (const child of ['reservations', 'bundles', 'state']) {
        await mkdir(join(directory, child), { mode: 0o700 });
      }
      const imageRoot = join(root, 'image');
      await mkdir(imageRoot, { mode: 0o700 });
      const storeOptions = {
        directory: join(directory, 'reservations'),
        bundleRoot: join(directory, 'bundles'),
        maxRecords: 256,
      };
      if (recovered) {
        const store = await FileRunscLaunchStore.open(storeOptions);
        const identity = {
          assignmentId: 'old-assignment',
          executionId: 'exec',
          attemptId: 'attempt',
          runnerId: 'runner',
          ownerSubject: 'owner',
          bootId: 'old-boot',
          generation: 1,
          epoch: 1,
        };
        const sandboxId = runscSandboxId(identity);
        await store.reserve(
          {
            identity,
            sandboxId,
            bundle: join(storeOptions.bundleRoot, sandboxId),
          },
          `sha256:${'a'.repeat(64)}`,
        );
        await store.close();
      }
      const options = {
        directory,
        imageRoot,
        manifest: null as never,
        approvedRootfsDigest: `sha256:${'a'.repeat(64)}`,
        program: ['/bin/agent'],
        executable: join(root, 'does-not-exist'),
        approvedExecutableSha256: 'a'.repeat(64),
        commandTimeoutMs: 100,
        runTimeoutMs: 100,
      };
      await assert.rejects(NativeRunscHost.open(options), /unavailable/);
      const lock = await readFile(join(storeOptions.directory, 'writer.lock'));
      await assert.rejects(NativeRunscHost.open(options), /unavailable/);
      assert.deepEqual(
        await readFile(join(storeOptions.directory, 'writer.lock')),
        lock,
      );
      assert.deepEqual(await readdir(join(directory, 'state')), []);
      assert.equal(
        (await readdir(storeOptions.directory)).length,
        recovered ? 2 : 1,
      );
    }
  },
);
