import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../src/infrastructure/database/client.js';
import { loadConfig } from '../src/infrastructure/config/environment-config.js';
import type { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { ApplicationError } from '../src/shared/domain/application-error.js';
import { PluginRegistryService } from '../src/modules/plugin-registry/application/plugin-registry.service.js';
import { PrismaPluginPackageRepository } from '../src/modules/plugin-registry/infrastructure/prisma-plugin-package.repository.js';
import { SignedPluginPackageReader } from '../src/modules/plugin-registry/infrastructure/signed-plugin-package.reader.js';
import { signedPluginFixture } from './fixtures/signed-plugin-package.js';

const db = createDatabaseClient(loadConfig());

test('app-owned plugin package activates only after matching attestation and revocation is final', async () => {
  const applicationId = `plugin-test-${randomUUID()}`;
  const fixture = signedPluginFixture(applicationId);
  const command = fixture.record;
  await db.$connect();
  await db.controlApplication.create({
    data: {
      id: applicationId,
      displayName: 'Plugin registry fixture',
      environment: 'local',
      keycloakClientId: `${applicationId}-client`,
    },
  });
  try {
    const repository = new PrismaPluginPackageRepository(
      db as unknown as DatabaseService,
    );
    const untrustedVerifier = new PluginRegistryService(repository, {
      async verify() {
        return {
          bundleDigest: '0'.repeat(64),
          attestationRef: `scan:${randomUUID()}`,
        };
      },
    });
    const staged = await Promise.all([
      untrustedVerifier.stage(command),
      untrustedVerifier.stage(command),
    ]);
    assert.deepEqual(
      staged.map((item) => item.state),
      ['STAGED', 'STAGED'],
    );
    assert.equal(await db.pluginPackage.count({ where: { applicationId } }), 1);
    await assert.rejects(
      db.pluginPackage.update({
        where: {
          applicationId_packageId_version: {
            applicationId,
            packageId: command.packageId,
            version: command.version,
          },
        },
        data: { bundleDigest: randomBytes(32).toString('hex') },
      }),
    );
    const forgedInput = {
      ...command,
      packageId: 'forged-state',
      objectKey: `plugins/v1/${randomUUID()}`,
      state: 'ACTIVE',
      attestationRef: 'scan:forged',
    };
    const forged = await untrustedVerifier.stage(forgedInput);
    assert.equal(forged.state, 'STAGED');
    assert.equal(
      (await untrustedVerifier.revoke(forgedInput, forged.revision)).state,
      'REVOKED',
    );
    await assert.rejects(
      untrustedVerifier.stage({ ...command, bundleDigest: 'f'.repeat(64) }),
      (error) =>
        error instanceof ApplicationError &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
    await assert.rejects(
      untrustedVerifier.activate(command, staged[0]!.revision),
      (error) =>
        error instanceof ApplicationError && error.code === 'POLICY_DENIED',
    );
    assert.equal((await repository.find(command))?.state, 'STAGED');

    const trustedVerifier = new PluginRegistryService(
      repository,
      new SignedPluginPackageReader(fixture.store, fixture.keys),
    );
    const activated = await trustedVerifier.activate(
      command,
      staged[0]!.revision,
    );
    assert.equal(activated.state, 'ACTIVE');
    assert.match(
      activated.attestationRef!,
      /^ed25519:release-key-1:[a-f0-9]{64}$/,
    );
    assert.equal(activated.revision, staged[0]!.revision + 1);
    assert.equal(
      (
        await trustedVerifier.resolve(
          command,
          command.bundleDigest,
          'claude-agent-sdk:0.3',
          ['artifact:write'],
        )
      ).objectKey,
      command.objectKey,
    );
    await assert.rejects(
      trustedVerifier.resolve(
        { ...command, applicationId: `${applicationId}-other` },
        command.bundleDigest,
        'claude-agent-sdk:0.3',
        ['artifact:write'],
      ),
      (error) =>
        error instanceof ApplicationError && error.code === 'POLICY_DENIED',
    );
    await assert.rejects(
      trustedVerifier.resolve(
        command,
        command.bundleDigest,
        'other-runtime:1',
        [],
      ),
      (error) =>
        error instanceof ApplicationError && error.code === 'POLICY_DENIED',
    );
    await assert.rejects(
      trustedVerifier.resolve(
        command,
        command.bundleDigest,
        'claude-agent-sdk:0.3',
        [],
      ),
      (error) =>
        error instanceof ApplicationError && error.code === 'POLICY_DENIED',
    );
    const revoked = await trustedVerifier.revoke(command, activated.revision);
    assert.equal(revoked.state, 'REVOKED');
    await assert.rejects(
      db.pluginPackage.update({
        where: {
          applicationId_packageId_version: {
            applicationId,
            packageId: command.packageId,
            version: command.version,
          },
        },
        data: { state: 'ACTIVE', revision: { increment: 1 } },
      }),
    );
    assert.equal(
      (await trustedVerifier.revoke(command, activated.revision)).revision,
      revoked.revision,
    );
    await assert.rejects(
      trustedVerifier.resolve(
        command,
        command.bundleDigest,
        'claude-agent-sdk:0.3',
        ['artifact:write'],
      ),
      (error) =>
        error instanceof ApplicationError && error.code === 'POLICY_DENIED',
    );
  } finally {
    await db.pluginPackage.deleteMany({ where: { applicationId } });
    await db.controlApplication.delete({ where: { id: applicationId } });
    await db.$disconnect();
  }
});
