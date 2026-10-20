import { spawn } from 'node:child_process';
import { release } from 'node:os';
import { nativeCoordinatorInvocation } from './lib/native-coordinator-profile.mjs';

const binaries = nativeCoordinatorInvocation(process.argv.slice(2), {
  platform: process.platform,
  arch: process.arch,
  release: release(),
  uid: process.geteuid?.(),
});
const child = spawn(
  process.execPath,
  [
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    'tests/m3/native-worker-coordinator.integration.ts',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      M3_NATIVE_COORDINATOR_DISPOSABLE: '1',
      M3_NATIVE_RUNSC_PATH: binaries.runsc,
      M3_NATIVE_BUSYBOX_PATH: binaries.busybox,
    },
  },
);
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
