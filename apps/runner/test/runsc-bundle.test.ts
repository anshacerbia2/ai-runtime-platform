import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  buildRunscSpec,
  rootfsManifestDigest,
  validateRootfsManifest,
  type RootfsManifest,
} from '../src/runsc-bundle.js';
import { runscBindingAnnotation } from '../src/runsc-sandbox-driver.js';

export const manifestFixture = (): RootfsManifest => ({
  format: 'ai-runtime-rootfs/v1',
  architecture: 'x64',
  directories: ['bin', 'dev', 'proc', 'tmp'],
  files: [
    {
      path: 'bin/program',
      bytes: 7,
      sha256: createHash('sha256').update('fixture').digest('hex'),
      executable: true,
    },
  ],
});

test('rootfs approval digest is canonical and binds every byte/size/mode/path/architecture', () => {
  const manifest = manifestFixture();
  const pin = rootfsManifestDigest(manifest);
  const verified = validateRootfsManifest(manifest, pin, 'x64');
  assert.equal(
    rootfsManifestDigest({
      ...manifest,
      directories: [...manifest.directories].reverse(),
    }),
    pin,
  );
  assert.ok(Object.isFrozen(verified.files[0]));
  for (const changed of [
    { ...manifest, architecture: 'arm64' as const },
    { ...manifest, files: [{ ...manifest.files[0]!, bytes: 8 }] },
    { ...manifest, files: [{ ...manifest.files[0]!, executable: false }] },
    { ...manifest, files: [{ ...manifest.files[0]!, sha256: '0'.repeat(64) }] },
  ]) {
    assert.throws(() => validateRootfsManifest(changed, pin, 'x64'));
  }
  assert.throws(() => validateRootfsManifest(manifest, pin, 'arm64'));
  assert.throws(() => validateRootfsManifest(manifest, '', 'x64'));
});

test('manifest rejects traversal, links/special metadata, undeclared parents and hidden mount contents', () => {
  const manifest = manifestFixture();
  for (const path of [
    '../outside',
    '/etc/passwd',
    'bin/../program',
    'bin\\program',
    'bin//program',
    'bin/./program',
    'a/b/c/d/e/f/g/h/i',
    'bin/program\0',
  ]) {
    assert.throws(() =>
      rootfsManifestDigest({
        ...manifest,
        files: [{ ...manifest.files[0]!, path }],
      }),
    );
  }
  for (const changed of [
    { ...manifest, files: [...manifest.files, ...manifest.files] },
    { ...manifest, directories: [...manifest.directories, 'bin'] },
    { ...manifest, directories: ['dev', 'proc', 'tmp'] },
    { ...manifest, files: [{ ...manifest.files[0]!, path: 'tmp/secret' }] },
    { ...manifest, files: [{ ...manifest.files[0]!, link: '/host' }] },
    { ...manifest, hooks: [] },
    { ...manifest, files: [{ ...manifest.files[0]!, bytes: 134217729 }] },
  ]) {
    assert.throws(() => rootfsManifestDigest(changed));
  }
});

test('fixed OCI policy copies binding/argv, exposes no host env/mounts, and rejects malformed commands', () => {
  const identity = {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner',
    ownerSubject: 'owner',
    bootId: randomUUID(),
    generation: 1,
    epoch: 1,
  };
  const captured = { ...identity };
  const args = ['/bin/program', '--fixed'];
  const digest = rootfsManifestDigest(manifestFixture());
  const spec = buildRunscSpec(identity, args, digest);
  identity.bootId = randomUUID();
  args.push('mutated');
  assert.equal(
    spec.annotations[runscBindingAnnotation],
    JSON.stringify(captured),
  );
  assert.equal(spec.annotations['org.ai-runtime.rootfs.digest.v1'], digest);
  assert.deepEqual(spec.process.args, ['/bin/program', '--fixed']);
  assert.deepEqual(spec.process.env, ['PATH=/bin', 'LANG=C']);
  assert.equal(spec.root.readonly, true);
  assert.equal(spec.root.path, 'rootfs');
  assert.equal(spec.process.user.uid, 65532);
  assert.equal(spec.process.noNewPrivileges, true);
  assert.ok(
    Object.values(spec.process.capabilities).every(
      (value) => value.length === 0,
    ),
  );
  assert.ok(spec.mounts.every((mount) => mount.type !== 'bind'));
  assert.ok(spec.linux.namespaces.every((value) => !('path' in value)));
  assert.equal(spec.linux.resources.pids.limit, 32);
  assert.equal(spec.linux.resources.memory.limit, 268435456);
  for (const command of [
    [],
    ['relative'],
    ['/bin/../program'],
    ['/bin/program', '\0'],
    Array(33).fill('/bin/program'),
  ]) {
    assert.throws(() => buildRunscSpec(captured, command, digest));
  }
});
