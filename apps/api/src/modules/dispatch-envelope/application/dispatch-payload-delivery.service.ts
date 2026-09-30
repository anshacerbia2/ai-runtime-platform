import type { RunnerLeaseCommand } from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
import type { DispatchPayloadAuthorization } from './dispatch-envelope.ports.js';
import { DispatchEnvelopeService } from './dispatch-envelope.service.js';

/** Returns plaintext only while the exact runner boot and assignment remain current. */
export class DispatchPayloadDeliveryService {
  constructor(
    private readonly authorization: DispatchPayloadAuthorization,
    private readonly envelopes: DispatchEnvelopeService,
  ) {}

  async read(
    principal: Principal,
    command: RunnerLeaseCommand,
    envelopeId: string,
  ): Promise<Uint8Array> {
    const { applicationId } = await this.authorization.assertCurrent(
      principal,
      command,
      envelopeId,
    );
    const plaintext = await this.envelopes.readCommitted(
      envelopeId,
      applicationId,
    );
    try {
      // Object download and KMS unwrap may outlast a revocation or lease loss.
      const afterRead = await this.authorization.assertCurrent(
        principal,
        command,
        envelopeId,
      );
      if (afterRead.applicationId !== applicationId) {
        throw new Error('Dispatch payload scope changed during delivery.');
      }
      return plaintext;
    } catch (error) {
      plaintext.fill(0);
      throw error;
    }
  }
}
