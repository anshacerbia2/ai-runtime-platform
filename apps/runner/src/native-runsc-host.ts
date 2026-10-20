import { lstat, realpath } from 'node:fs/promises';
import { posix } from 'node:path';
import { FileRunscLaunchStore } from './file-runsc-launch-store.js';
import { FileRunscBundleProducer } from './file-runsc-bundle-producer.js';
import { RunscCgroupInspector } from './runsc-cgroup-inspector.js';
import { RunscProcessClient } from './runsc-process-client.js';
import { RunscHostLifecycle } from './runsc-host-lifecycle.js';
import type { RootfsManifest } from './runsc-bundle.js';

export interface NativeRunscHostOptions {
  /** Existing private canonical directory containing reservations/, bundles/, state/. */
  readonly directory: string;
  readonly imageRoot: string;
  readonly manifest: RootfsManifest;
  readonly approvedRootfsDigest: string;
  /** Fixed trusted launcher, not request-provided argv. */
  readonly program: readonly string[];
  readonly executable: string;
  readonly approvedExecutableSha256: string;
  readonly commandTimeoutMs: number;
  readonly runTimeoutMs: number;
}
const failure = () =>
  new Error('Native runsc host unavailable; ownership is not transferred.');
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Fresh private namespace only. No stale-lock takeover or production configuration default. */
export class NativeRunscHost {
  static async open(
    options: NativeRunscHostOptions,
  ): Promise<RunscHostLifecycle> {
    if (process.platform !== 'linux') {
      throw failure();
    }
    const captured = { ...options, program: [...options.program] };
    let store: FileRunscLaunchStore | undefined;
    let bundles: FileRunscBundleProducer | undefined;
    let runtime: RunscProcessClient | undefined;
    let cgroups: RunscCgroupInspector | undefined;
    try {
      const directory = captured.directory;
      if (
        typeof directory !== 'string' ||
        !posix.isAbsolute(directory) ||
        posix.resolve(directory) !== directory ||
        directory === '/' ||
        directory.length > 2000 ||
        directory.includes('\0') ||
        (await realpath(directory)) !== directory ||
        overlaps(directory, captured.imageRoot) ||
        overlaps(directory, captured.executable)
      ) {
        throw failure();
      }
      const info = await lstat(directory);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== process.geteuid?.() ||
        (info.mode & 0o7777) !== 0o700
      ) {
        throw failure();
      }
      const bundleRoot = posix.join(directory, 'bundles');
      // Acquire the one layout-bound lock before opening any runtime component.
      store = await FileRunscLaunchStore.open({
        directory: posix.join(directory, 'reservations'),
        bundleRoot,
        maxRecords: 256,
      });
      if (store.recoveryRequired) {
        throw failure();
      }
      bundles = await FileRunscBundleProducer.open({
        imageRoot: captured.imageRoot,
        bundleRoot,
        manifest: captured.manifest,
        approvedRootfsDigest: captured.approvedRootfsDigest,
        programs: { agent: captured.program },
      });
      if (bundles.recoveryRequired) {
        throw failure();
      }
      runtime = await RunscProcessClient.open({
        executable: captured.executable,
        approvedExecutableSha256: captured.approvedExecutableSha256,
        stateRoot: posix.join(directory, 'state'),
        bundleRoot,
        commandTimeoutMs: captured.commandTimeoutMs,
        runTimeoutMs: captured.runTimeoutMs,
      });
      if ((await runtime.list()).length !== 0) {
        throw failure();
      }
      cgroups = await RunscCgroupInspector.open();
      return new RunscHostLifecycle(
        { store, bundles, runtime, cgroups },
        {
          bundleRoot,
          program: 'agent',
          approvedRootfsDigest: captured.approvedRootfsDigest,
        },
      );
    } catch {
      // Failed startup cannot prove a prior monitor/partial creation absent.
      await Promise.allSettled([
        bundles?.close(),
        runtime?.close(),
        cgroups?.close(),
      ]);
      await store?.close({ retainLock: true }).catch(() => {});
      throw failure();
    }
  }
}
