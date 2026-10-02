import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  pluginPackageSigningBytes,
  validatePluginBundle,
  PluginBundleError,
} from '@ai-runtime/plugin-package';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type {
  PluginPackageBytesStore,
  PluginPackageRecord,
  PluginPackageVerifier,
  PluginSigningKeyResolver,
  VerifiedPluginPackageReader,
} from '../application/plugin-registry.port.js';

const OBJECT_KEY =
  /^plugins\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;

function denied(): never {
  throw new ApplicationError(
    'POLICY_DENIED',
    'Plugin package verification failed.',
  );
}

function signatureDocument(bytes: Uint8Array) {
  try {
    if (bytes.byteLength < 2 || bytes.byteLength > MAX_SIGNATURE_BYTES) {
      denied();
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(source);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      JSON.stringify(value) !== source
    ) {
      denied();
    }
    const document = value as Record<string, unknown>;
    if (
      Object.keys(document).length !== 4 ||
      document.format !== 'ai-runtime-plugin-signature/v1' ||
      document.algorithm !== 'Ed25519' ||
      typeof document.keyId !== 'string' ||
      !KEY_ID.test(document.keyId) ||
      typeof document.signatureBase64 !== 'string'
    ) {
      denied();
    }
    const signature = Buffer.from(document.signatureBase64, 'base64');
    if (
      signature.byteLength !== 64 ||
      signature.toString('base64') !== document.signatureBase64
    ) {
      denied();
    }
    return { keyId: document.keyId, signature };
  } catch {
    denied();
  }
}

async function bounded<T>(
  work: Promise<T>,
  signal: AbortSignal,
  discard?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(
        new ApplicationError(
          'DEPENDENCY_UNAVAILABLE',
          'Plugin verification timed out.',
        ),
      );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
    }
    work
      .then((value) => {
        if (signal.aborted) {
          discard?.(value);
          abort();
        } else {
          resolve(value);
        }
      }, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Verifies trusted provenance and stored bytes without executing or mounting plugin files. */
export class SignedPluginPackageReader
  implements PluginPackageVerifier, VerifiedPluginPackageReader
{
  constructor(
    private readonly objects: PluginPackageBytesStore,
    private readonly keys: PluginSigningKeyResolver,
    private readonly timeoutMs = 10_000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60_000
    ) {
      throw new Error('Invalid plugin verification deadline.');
    }
  }

  async verify(record: PluginPackageRecord) {
    const result = await this.readVerified(record);
    result.bytes.fill(0);
    return result.attestation;
  }

  async readVerified(record: PluginPackageRecord) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.read(record, controller.signal);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        'DEPENDENCY_UNAVAILABLE',
        'Plugin verification dependency failed.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async read(record: PluginPackageRecord, signal: AbortSignal) {
    if (
      !OBJECT_KEY.test(record.objectKey) ||
      record.state === 'REVOKED' ||
      !Number.isSafeInteger(record.bundleBytes) ||
      record.bundleBytes < 2 ||
      record.bundleBytes > MAX_BUNDLE_BYTES ||
      record.compatibleRuntimeVersions.length < 1
    ) {
      denied();
    }
    const signed = await bounded(
      this.objects.get(
        `${record.objectKey}.signature.json`,
        MAX_SIGNATURE_BYTES,
        signal,
      ),
      signal,
    );
    if (!signed) {
      denied();
    }
    const document = signatureDocument(signed);
    const statement = pluginPackageSigningBytes(record, document.keyId);
    const checkKey = async () => {
      const pem = await bounded(
        this.keys.resolve(record.applicationId, document.keyId, signal),
        signal,
      );
      if (!pem || pem.length > 8192) {
        denied();
      }
      try {
        const key = createPublicKey(pem);
        if (
          key.asymmetricKeyType !== 'ed25519' ||
          !verify(null, statement, key, document.signature)
        ) {
          denied();
        }
      } catch {
        denied();
      }
    };
    await checkKey();
    const bytes = await bounded(
      this.objects.get(record.objectKey, record.bundleBytes, signal),
      signal,
      (late) => late?.fill(0),
    );
    if (!bytes) {
      denied();
    }
    try {
      if (bytes.byteLength !== record.bundleBytes) {
        denied();
      }
      const parsed = validatePluginBundle(bytes, {
        packageId: record.packageId,
        version: record.version,
        digest: record.bundleDigest,
        state: 'ACTIVE',
        runtimeVersion: record.compatibleRuntimeVersions[0]!,
        allowedPermissions: record.requiredPermissions,
      });
      const sameSet = (left: readonly string[], right: readonly string[]) =>
        [...left].sort().join('\0') === [...right].sort().join('\0');
      if (
        !sameSet(
          parsed.bundle.compatibleRuntimeVersions,
          record.compatibleRuntimeVersions,
        ) ||
        !sameSet(parsed.bundle.requiredPermissions, record.requiredPermissions)
      ) {
        denied();
      }
      await checkKey();
      return {
        bytes,
        attestation: {
          bundleDigest: record.bundleDigest,
          attestationRef: `ed25519:${document.keyId}:${createHash('sha256').update(signed).digest('hex')}`,
        },
      };
    } catch (error) {
      bytes.fill(0);
      if (error instanceof ApplicationError) {
        throw error;
      }
      if (error instanceof PluginBundleError) {
        denied();
      }
      throw error;
    }
  }
}
