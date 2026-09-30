import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  materializePluginBundle,
  PluginBundleError,
  type TrustedPluginGrant,
} from '../src/plugin-bundle.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixture(overrides: Record<string, unknown> = {}) {
  const content = Buffer.from('fixture instructions');
  const bundle = {
    format: 'ai-runtime-plugin/v1',
    packageId: 'scribe-draft',
    version: '1.0.0',
    compatibleRuntimeVersions: ['claude-agent-sdk:0.3'],
    requiredPermissions: ['artifact:write'],
    files: [
      {
        path: '.claude-plugin/plugin.json',
        sha256: sha256(content),
        contentBase64: content.toString('base64'),
      },
    ],
    ...overrides,
  };
  const bytes = Buffer.from(JSON.stringify(bundle));
  const grant: TrustedPluginGrant = {
    packageId: 'scribe-draft',
    version: '1.0.0',
    digest: sha256(bytes),
    state: 'ACTIVE',
    runtimeVersion: 'claude-agent-sdk:0.3',
    allowedPermissions: ['artifact:write'],
  };
  return { bytes, grant };
}

async function privateRoot() {
  const root = await mkdtemp(join(tmpdir(), 'ai-runtime-plugin-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  return root;
}

test('materializes a digest-pinned plugin with ordinary files only', async () => {
  const root = await privateRoot();
  try {
    const { bytes, grant } = fixture();
    const result = await materializePluginBundle(root, bytes, grant);
    assert.equal(result.digest, grant.digest);
    assert.deepEqual(result.files, ['.claude-plugin/plugin.json']);
    assert.equal(
      (
        await readFile(join(result.directory, '.claude-plugin', 'plugin.json'))
      ).toString(),
      'fixture instructions',
    );
    await assert.rejects(materializePluginBundle(root, bytes, grant));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects revoked, changed, incompatible, and escaping plugin bundles before writing', async () => {
  const root = await privateRoot();
  try {
    const ordinary = fixture();
    const traversal = fixture({
      files: [
        {
          path: '../outside.txt',
          sha256: sha256(Buffer.from('bad')),
          contentBase64: Buffer.from('bad').toString('base64'),
        },
      ],
    });
    const conflictingPaths = fixture({
      files: [
        {
          path: 'skills',
          sha256: sha256(Buffer.from('one')),
          contentBase64: Buffer.from('one').toString('base64'),
        },
        {
          path: 'skills/README.md',
          sha256: sha256(Buffer.from('two')),
          contentBase64: Buffer.from('two').toString('base64'),
        },
      ],
    });
    const cases: Array<{ bytes: Uint8Array; grant: TrustedPluginGrant }> = [
      { ...ordinary, grant: { ...ordinary.grant, state: 'REVOKED' } },
      { ...ordinary, grant: { ...ordinary.grant, digest: '0'.repeat(64) } },
      {
        ...ordinary,
        grant: { ...ordinary.grant, runtimeVersion: 'other-runtime:1' },
      },
      { ...ordinary, grant: { ...ordinary.grant, allowedPermissions: [] } },
      traversal,
      conflictingPaths,
      {
        bytes: Buffer.from(` ${ordinary.bytes.toString()}`),
        grant: {
          ...ordinary.grant,
          digest: sha256(Buffer.from(` ${ordinary.bytes.toString()}`)),
        },
      },
    ];
    for (const candidate of cases) {
      await assert.rejects(
        materializePluginBundle(root, candidate.bytes, candidate.grant),
        PluginBundleError,
      );
    }
    await assert.rejects(readFile(join(root, 'outside.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
