import {
  RunnerDispatchGrant,
  RunnerLeaseCommand,
  runnerPayloadHandoffContract,
  runnerPluginHandoffContract,
} from '@ai-runtime/contracts/http';
import { validatePluginBundle } from '@ai-runtime/plugin-package';
import {
  RunnerHttpError,
  RunnerHttpTransport,
  type RunnerHttpOptions,
} from './runner-http-transport.js';

/** Scoped coordinator delivery only; never accepts an object key or storage credential. */
export class RunnerDispatchHttpClient {
  private readonly command: RunnerLeaseCommand;
  private readonly grant: RunnerDispatchGrant;
  private readonly transport: RunnerHttpTransport;

  constructor(
    command: RunnerLeaseCommand,
    grant: RunnerDispatchGrant,
    http: RunnerHttpOptions,
  ) {
    try {
      this.command = RunnerLeaseCommand.parse(command);
      this.grant = RunnerDispatchGrant.parse(grant);
      if (
        Object.entries(this.command.token).some(
          ([key, value]) =>
            value !== this.grant[key as keyof RunnerDispatchGrant],
        )
      ) {
        throw new Error();
      }
    } catch {
      throw new RunnerHttpError('INVALID');
    }
    this.transport = new RunnerHttpTransport(http);
  }

  async payload(signal?: AbortSignal): Promise<Uint8Array> {
    const bytes = await this.transport.postBinary(
      runnerPayloadHandoffContract.payload.path,
      { ...this.command, envelopeId: this.grant.envelopeId },
      this.grant.plaintextBytes,
      signal,
    );
    if (signal?.aborted || bytes.byteLength !== this.grant.plaintextBytes) {
      bytes.fill(0);
      throw new RunnerHttpError('INVALID');
    }
    // inputDigest is canonical request identity, not plaintextSha256. The
    // coordinator verifies AEAD/plaintext integrity before scoped delivery.
    return bytes;
  }

  async plugin(signal?: AbortSignal): Promise<Uint8Array | null> {
    const plugin = this.grant.plugin;
    if (!plugin) {
      return null;
    }
    const bytes = await this.transport.postBinary(
      runnerPluginHandoffContract.plugin.path,
      { ...this.command, envelopeId: this.grant.envelopeId },
      runnerPluginHandoffContract.plugin.metadata.behavior.maxResponseBytes,
      signal,
    );
    try {
      if (signal?.aborted) {
        throw new Error();
      }
      validatePluginBundle(bytes, {
        packageId: plugin.packageId,
        version: plugin.version,
        digest: plugin.bundleDigest,
        state: 'ACTIVE',
        runtimeVersion: plugin.runtimeVersion,
        allowedPermissions: plugin.requiredPermissions,
      });
      return bytes;
    } catch {
      bytes.fill(0);
      throw new RunnerHttpError('INVALID');
    }
  }
}
