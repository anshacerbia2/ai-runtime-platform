import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCoordinatorInvocation } from '../lib/native-coordinator-profile.mjs';

test('native coordinator gate requires exact disposable Linux root invocation before any mutation', () => {
  const host = { platform: 'linux', arch: 'x64', release: '6.17.0', uid: 0 };
  const args = ['--disposable-linux-host', '/trusted/runsc', '/bin/busybox'];
  assert.deepEqual(nativeCoordinatorInvocation(args, host), {
    runsc: '/trusted/runsc',
    busybox: '/bin/busybox',
  });
  for (const changed of [
    { platform: 'win32' },
    { uid: 1000 },
    { arch: 'arm64' },
    { release: '5.4.0' },
  ]) {
    assert.throws(() =>
      nativeCoordinatorInvocation(args, { ...host, ...changed }),
    );
  }
  for (const invalid of [
    [],
    args.slice(1),
    [...args, '--extra'],
    ['--disposable-linux-host', 'relative', '/bin/busybox'],
    ['--disposable-linux-host', '/trusted/../runsc', '/bin/busybox'],
    ['--disposable-linux-host', '/trusted/runsc\0', '/bin/busybox'],
  ]) {
    assert.throws(() => nativeCoordinatorInvocation(invalid, host));
  }
});
