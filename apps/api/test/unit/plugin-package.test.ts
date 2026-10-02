import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import { validatePluginBundle } from '@ai-runtime/plugin-package';
import { ApplicationError } from '../../src/shared/domain/application-error.js';
import { SignedPluginPackageReader } from '../../src/modules/plugin-registry/infrastructure/signed-plugin-package.reader.js';
import { PluginPackageDeliveryService } from '../../src/modules/plugin-registry/application/plugin-package-delivery.service.js';
import type { Principal } from '../../src/modules/identity/domain/principal.js';
import { signedPluginFixture } from '../fixtures/signed-plugin-package.js';

const denied = (error: unknown) =>
  error instanceof ApplicationError && error.code === 'POLICY_DENIED';
const unavailable = (error: unknown) =>
  error instanceof ApplicationError && error.code === 'DEPENDENCY_UNAVAILABLE';

test('verifier sanitizes errors from trusted-store and signer dependencies', async () => {
  const f = signedPluginFixture();
  const brokenStore = new SignedPluginPackageReader(
    {
      async get() {
        throw new Error('storage-secret');
      },
    },
    f.keys,
  );
  const brokenKeys = new SignedPluginPackageReader(f.store, {
    async resolve() {
      throw new Error('signer-secret');
    },
  });
  for (const reader of [brokenStore, brokenKeys]) {
    await assert.rejects(
      reader.readVerified(f.record),
      (error: unknown) =>
        unavailable(error) &&
        error instanceof Error &&
        !error.message.includes('secret'),
    );
  }
});

test('verifies stored signature, bytes and app-scoped signer; attestation is stable', async () => {
  const f = signedPluginFixture();
  const reader = new SignedPluginPackageReader(f.store, f.keys);
  const attestation = await reader.verify(f.record);
  assert.match(
    attestation.attestationRef,
    /^ed25519:release-key-1:[a-f0-9]{64}$/,
  );
  const result = await reader.readVerified(f.record);
  assert.deepEqual(Buffer.from(result.bytes), f.bytes);
  assert.deepEqual(result.attestation, attestation);
  const parsed = validatePluginBundle(result.bytes, {
    packageId: f.record.packageId,
    version: f.record.version,
    digest: f.record.bundleDigest,
    state: 'ACTIVE',
    runtimeVersion: 'claude-agent-sdk:0.3',
    allowedPermissions: ['artifact:write'],
  });
  assert.equal(parsed.files[0]!.path, '.claude-plugin/plugin.json');
});

test('rejects signature replay across app, package, object, digest, size, runtime or permission metadata', async () => {
  const f = signedPluginFixture();
  // Deliberately allow the same key in both apps: the signed statement must still bind app identity.
  const reader = new SignedPluginPackageReader(f.store, {
    async resolve() {
      return f.pem;
    },
  });
  const otherKey = `plugins/v1/${randomUUID()}`;
  f.objects.set(
    `${otherKey}.signature.json`,
    f.objects.get(`${f.record.objectKey}.signature.json`)!,
  );
  f.objects.set(otherKey, f.bytes);
  const mutations = [
    { applicationId: 'another-app' },
    { packageId: 'different' },
    { version: '2.0.0' },
    { objectKey: otherKey },
    { bundleDigest: '0'.repeat(64) },
    { bundleBytes: f.record.bundleBytes + 1 },
    { compatibleRuntimeVersions: ['other-runtime:1'] },
    { requiredPermissions: [] },
    { state: 'REVOKED' as const },
  ];
  for (const mutation of mutations) {
    await assert.rejects(
      reader.readVerified({ ...f.record, ...mutation }),
      denied,
    );
  }
});

test('rejects malformed sidecars, unknown keys and non-Ed25519 trusted keys', async () => {
  const f = signedPluginFixture();
  const sidecar = `${f.record.objectKey}.signature.json`;
  const original = f.objects.get(sidecar)!;
  for (const value of [
    Buffer.from('{}'),
    Buffer.from(' ' + Buffer.from(original).toString()),
    Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(original).toString()),
        extra: true,
      }),
    ),
    Buffer.from(
      JSON.stringify({
        format: 'ai-runtime-plugin-signature/v1',
        algorithm: 'Ed25519',
        keyId: f.keyId,
        signatureBase64: 'AA==',
      }),
    ),
  ]) {
    f.objects.set(sidecar, value);
    await assert.rejects(
      new SignedPluginPackageReader(f.store, f.keys).readVerified(f.record),
      denied,
    );
  }
  f.objects.set(sidecar, original);
  await assert.rejects(
    new SignedPluginPackageReader(f.store, {
      async resolve() {
        return null;
      },
    }).readVerified(f.record),
    denied,
  );
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await assert.rejects(
    new SignedPluginPackageReader(f.store, {
      async resolve() {
        return publicKey.export({ type: 'spki', format: 'pem' }).toString();
      },
    }).readVerified(f.record),
    denied,
  );
});

test('rejects changed bytes and signed but unsafe or mismatched manifest metadata', async () => {
  for (const mutation of [
    { ...signedPluginFixture().manifest, unknown: 'not-supported' },
    { ...signedPluginFixture().manifest, requiredPermissions: [] },
    {
      ...signedPluginFixture().manifest,
      compatibleRuntimeVersions: ['claude-agent-sdk:0.3', 'other-runtime:1'],
    },
    {
      ...signedPluginFixture().manifest,
      files: [
        {
          path: '../escape',
          sha256: createHash('sha256').update('bad').digest('hex'),
          contentBase64: Buffer.from('bad').toString('base64'),
        },
      ],
    },
  ]) {
    const f = signedPluginFixture();
    const bytes = Buffer.from(JSON.stringify(mutation));
    const record = {
      ...f.record,
      bundleBytes: bytes.byteLength,
      bundleDigest: createHash('sha256').update(bytes).digest('hex'),
    };
    f.objects.set(record.objectKey, bytes);
    f.objects.set(`${record.objectKey}.signature.json`, f.signature(record));
    await assert.rejects(
      new SignedPluginPackageReader(f.store, f.keys).readVerified(record),
      denied,
    );
  }
  const f = signedPluginFixture();
  const changed = Uint8Array.from(f.bytes);
  changed[changed.length - 2] = changed[changed.length - 2]! ^ 1;
  f.objects.set(f.record.objectKey, changed);
  await assert.rejects(
    new SignedPluginPackageReader(f.store, f.keys).readVerified(f.record),
    denied,
  );
});

test('signer revocation during download rejects and erases the downloaded buffer', async () => {
  const f = signedPluginFixture();
  let checks = 0;
  let downloaded: Uint8Array | null = null;
  const reader = new SignedPluginPackageReader(
    {
      async get(key) {
        const bytes = await f.store.get(key);
        if (key === f.record.objectKey) {
          downloaded = bytes;
        }
        return bytes;
      },
    },
    {
      async resolve() {
        return ++checks === 1 ? f.pem : null;
      },
    },
  );
  await assert.rejects(reader.readVerified(f.record), denied);
  assert.equal(checks, 2);
  assert.ok(
    downloaded && (downloaded as Uint8Array).every((byte) => byte === 0),
  );
});

test('verification has a bounded deadline even if a key resolver ignores abort', async () => {
  const f = signedPluginFixture();
  const reader = new SignedPluginPackageReader(
    f.store,
    {
      resolve() {
        return new Promise(() => {});
      },
    },
    20,
  );
  await assert.rejects(reader.readVerified(f.record), unavailable);
});

test('a late object read after timeout is discarded and erased', async () => {
  const f = signedPluginFixture();
  let finish: ((bytes: Uint8Array) => void) | undefined;
  const reader = new SignedPluginPackageReader(
    {
      async get(key) {
        if (key !== f.record.objectKey) {
          return f.store.get(key);
        }
        return new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        });
      },
    },
    f.keys,
    20,
  );
  await assert.rejects(reader.readVerified(f.record), unavailable);
  const late = Uint8Array.from(f.bytes);
  assert.ok(finish);
  finish(late);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(late.every((byte) => byte === 0));
});

const principal: Principal = {
  subject: 'runner-owner',
  kind: 'runner',
  roles: ['runtime-runner'],
  scopes: ['runner:report'],
};
const command: RunnerLeaseCommand = {
  token: {
    assignmentId: randomUUID(),
    executionId: randomUUID(),
    attemptId: randomUUID(),
    runnerId: 'runner-fixture',
    generation: 1,
    epoch: 1,
  },
  bootId: randomUUID(),
  registrationRevision: 1,
  nonce: 'n'.repeat(32),
};

test('delivery returns only pinned bytes and checks current authorization on both sides of download', async () => {
  const f = signedPluginFixture();
  const reader = new SignedPluginPackageReader(f.store, f.keys);
  const active = {
    ...f.record,
    state: 'ACTIVE' as const,
    revision: 2,
    attestationRef: (await reader.verify(f.record)).attestationRef,
  };
  let checks = 0;
  const service = new PluginPackageDeliveryService(
    {
      async assertCurrent(p, c, envelopeId) {
        assert.equal(p, principal);
        assert.equal(c, command);
        assert.equal(envelopeId, 'bound-envelope');
        checks++;
        return active;
      },
    },
    reader,
  );
  assert.deepEqual(
    Buffer.from(await service.read(principal, command, 'bound-envelope')),
    f.bytes,
  );
  assert.equal(checks, 2);
});

test('delivery erases bytes on lease loss, package revocation, changed revision or attestation', async () => {
  for (const mutation of [
    'lease',
    'revocation',
    'revision',
    'attestation',
    'initial-staged',
  ]) {
    const f = signedPluginFixture();
    const reader = new SignedPluginPackageReader(f.store, f.keys);
    const attestation = await reader.verify(f.record);
    const active = {
      ...f.record,
      state: 'ACTIVE' as const,
      revision: 2,
      attestationRef: attestation.attestationRef,
    };
    let checks = 0;
    let delivered: Uint8Array | undefined;
    const service = new PluginPackageDeliveryService(
      {
        async assertCurrent() {
          if (mutation === 'initial-staged') {
            return f.record;
          }
          if (++checks === 1) {
            return active;
          }
          if (mutation === 'lease') {
            throw new ApplicationError('STALE_ASSIGNMENT', 'Lease expired.');
          }
          if (mutation === 'revocation') {
            return { ...active, state: 'REVOKED' as const };
          }
          if (mutation === 'revision') {
            return { ...active, revision: 3 };
          }
          return { ...active, attestationRef: 'changed' };
        },
      },
      {
        async readVerified(record) {
          const result = await reader.readVerified(record);
          delivered = result.bytes;
          return result;
        },
      },
    );
    await assert.rejects(
      service.read(principal, command, 'bound-envelope'),
      ApplicationError,
    );
    if (mutation === 'initial-staged') {
      assert.equal(delivered, undefined);
    } else {
      assert.ok(delivered!.every((byte) => byte === 0));
    }
  }
});
