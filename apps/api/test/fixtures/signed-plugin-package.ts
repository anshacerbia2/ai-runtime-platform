import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { pluginPackageSigningBytes } from '@ai-runtime/plugin-package';
import type { PluginPackageRecord } from '../../src/modules/plugin-registry/application/plugin-registry.port.js';

export function signedPluginFixture(
  applicationId = 'plugin-fixture',
  packageId = 'scribe-draft',
) {
  const content = Buffer.from('fixture instructions');
  const manifest = {
    format: 'ai-runtime-plugin/v1',
    packageId,
    version: '1.0.0',
    compatibleRuntimeVersions: ['claude-agent-sdk:0.3'],
    requiredPermissions: ['artifact:write'],
    files: [
      {
        path: '.claude-plugin/plugin.json',
        sha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  const record: PluginPackageRecord = {
    applicationId,
    packageId: manifest.packageId,
    version: manifest.version,
    bundleDigest: createHash('sha256').update(bytes).digest('hex'),
    objectKey: `plugins/v1/${randomUUID()}`,
    bundleBytes: bytes.byteLength,
    compatibleRuntimeVersions: manifest.compatibleRuntimeVersions,
    requiredPermissions: manifest.requiredPermissions,
    state: 'STAGED',
    revision: 1,
    attestationRef: null,
  };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = 'release-key-1';
  const signature = (subject = record) =>
    Buffer.from(
      JSON.stringify({
        format: 'ai-runtime-plugin-signature/v1',
        algorithm: 'Ed25519',
        keyId,
        signatureBase64: sign(
          null,
          pluginPackageSigningBytes(subject, keyId),
          privateKey,
        ).toString('base64'),
      }),
    );
  const objects = new Map<string, Uint8Array>([
    [record.objectKey, bytes],
    [`${record.objectKey}.signature.json`, signature()],
  ]);
  const store = {
    async get(key: string) {
      const found = objects.get(key);
      return found ? Uint8Array.from(found) : null;
    },
  };
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keys = {
    async resolve(app: string, id: string) {
      return app === applicationId && id === keyId ? pem : null;
    },
  };
  return {
    record,
    bytes,
    manifest,
    store,
    keys,
    pem,
    objects,
    signature,
    keyId,
  };
}
