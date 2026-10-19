import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  assertProbeHost,
  fixtureIdentity,
  fixtureSpec,
  assertFixtureState,
  runscFlags,
  parseRunscList,
  assertLoopbackRoutes,
} from '../lib/gvisor-profile.mjs';

test('no-network gVisor may retain guest loopback but rejects any external route', () => {
  assert.doesNotThrow(() =>
    assertLoopbackRoutes(
      '::1 dev lo scope link\n127.0.0.0/8 dev lo scope link\n',
    ),
  );
  assert.doesNotThrow(() => assertLoopbackRoutes(''));
  for (const route of [
    'default via 10.0.0.1 dev eth0',
    '10.0.0.0/8 dev eth0 scope link',
    '::/0 dev eth0',
    '169.254.0.0/16 dev lo scope link',
    '127.0.0.0/8 dev eth0 scope link',
  ]) {
    assert.throws(() => assertLoopbackRoutes(route));
  }
});

test('pinned runsc empty-list null is explicit while malformed observations fail closed', () => {
  assert.deepEqual(parseRunscList('null\n'), []);
  assert.deepEqual(parseRunscList('[]'), []);
  const row = {
    id: fixtureIdentity(randomUUID()).sandboxId,
    status: 'stopped',
  };
  assert.deepEqual(parseRunscList(JSON.stringify([row])), [row]);
  for (const value of [
    '',
    '{}',
    'false',
    '[null]',
    '[{}]',
    JSON.stringify([{ ...row, status: 'unknown' }]),
  ]) {
    assert.throws(() => parseRunscList(value));
  }
});

test('gVisor probe rejects unsupported hosts and requires explicit disposable-host opt-in', () => {
  const host = {
    platform: 'linux',
    arch: 'x64',
    release: '6.8.0-99-generic',
    uid: 0,
    disposable: true,
  };
  assert.doesNotThrow(() => assertProbeHost(host));
  for (const change of [
    { platform: 'win32' },
    { arch: 'ia32' },
    { release: '5.4.0' },
    { release: 'unknown' },
    { uid: 1000 },
    { disposable: false },
  ]) {
    assert.throws(() => assertProbeHost({ ...host, ...change }));
  }
  assert.doesNotThrow(() =>
    assertProbeHost({ ...host, arch: 'arm64', release: '5.6.0' }),
  );
});

test('gVisor fixture has fixed no-network runtime policy and bounded least-privilege OCI config', () => {
  const identity = fixtureIdentity(randomUUID());
  const spec = fixtureSpec(identity, 'forced');
  assert.equal(spec.root.path, 'rootfs');
  assert.equal(spec.root.readonly, true);
  assert.equal(spec.process.user.uid, 65532);
  assert.equal(spec.process.noNewPrivileges, true);
  assert.ok(
    Object.values(spec.process.capabilities).every((caps) => caps.length === 0),
  );
  assert.deepEqual(spec.process.env, ['PATH=/bin', 'LANG=C']);
  assert.ok(spec.mounts.every((mount) => mount.type !== 'bind'));
  assert.ok(
    spec.mounts
      .find((mount) => mount.destination === '/tmp')
      .options.includes('size=8388608'),
  );
  assert.equal(spec.linux.resources.memory.limit, 268435456);
  assert.equal(spec.linux.resources.pids.limit, 32);
  assert.equal(spec.linux.resources.cpu.quota, 50000);
  assert.ok(spec.linux.namespaces.every((ns) => !('path' in ns)));
  const flags = runscFlags('/tmp/fixture-state');
  assert.ok(flags.includes('--network=none'));
  assert.ok(flags.includes('--platform=systrap'));
  assert.equal(
    flags.some((flag) =>
      /ignore-cgroups|test-only|disable-seccomp|network=host/.test(flag),
    ),
    false,
  );
  assert.throws(() => runscFlags('relative-state'));
  assert.throws(() => fixtureSpec(identity, 'arbitrary-command'));
});

test('recovery observation rejects a foreign binding, bundle or runtime state', () => {
  const identity = fixtureIdentity(randomUUID());
  const spec = fixtureSpec(identity, 'graceful');
  const state = {
    id: identity.sandboxId,
    bundle: '/tmp/fixture-bundle',
    status: 'running',
    annotations: spec.annotations,
  };
  assert.doesNotThrow(() =>
    assertFixtureState(state, identity, '/tmp/fixture-bundle'),
  );
  for (const change of [
    { bootId: randomUUID() },
    { ownerSubject: 'foreign-owner' },
    { generation: 2 },
    { epoch: 2 },
    { runnerId: 'foreign-runner' },
    { attemptId: randomUUID() },
    { executionId: randomUUID() },
  ]) {
    assert.throws(() =>
      assertFixtureState(
        state,
        { ...identity, ...change },
        '/tmp/fixture-bundle',
      ),
    );
  }
  for (const change of [
    { id: 'other' },
    { status: 'unknown' },
    { annotations: {} },
    { bundle: '/tmp/foreign' },
  ]) {
    assert.throws(() =>
      assertFixtureState(
        { ...state, ...change },
        identity,
        '/tmp/fixture-bundle',
      ),
    );
  }
});
