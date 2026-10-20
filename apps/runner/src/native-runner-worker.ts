import {
  NativeRunscHost,
  type NativeRunscHostOptions,
} from './native-runsc-host.js';
import { RunscSandboxDriver } from './runsc-sandbox-driver.js';
import { RunnerWorker, type RunnerWorkerOptions } from './runner-worker.js';

/** Trusted opt-in composition; no process signals, credentials or production defaults are installed. */
export async function openNativeRunnerWorker(
  sandbox: NativeRunscHostOptions,
  options: Omit<RunnerWorkerOptions, 'driver' | 'sandboxLifecycle'>,
): Promise<RunnerWorker> {
  // The native process transport has eight simultaneous original monitor slots.
  if (
    !Number.isSafeInteger(options.capacity) ||
    options.capacity < 1 ||
    options.capacity > 8
  ) {
    throw new Error('Native runner capacity must be 1-8.');
  }
  const host = await NativeRunscHost.open(sandbox);
  try {
    return new RunnerWorker({
      ...options,
      driver: new RunscSandboxDriver(host),
      sandboxLifecycle: host,
    });
  } catch {
    await host.close({ retainLock: true }).catch(() => {});
    throw new Error(
      'Native runner worker unavailable; ownership is not transferred.',
    );
  }
}
