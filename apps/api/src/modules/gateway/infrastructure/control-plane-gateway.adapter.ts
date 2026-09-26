import { createHash } from 'node:crypto';
import type { M1Repository } from '../../control-plane/application/m1-repository.port.js';
import type { M1ControlPlaneService } from '../../control-plane/application/m1-control-plane.service.js';
import type { Principal } from '../../identity/domain/principal.js';
import type { GatewayControl } from '../application/gateway-control.port.js';
import type { GatewayClaim } from '../application/gateway-repository.port.js';

const accountant: Principal = {
  subject: 'gateway-provider-verifier',
  kind: 'operator',
  roles: ['platform-accountant'],
  scopes: ['usage:verify'],
};

export class ControlPlaneGatewayAdapter implements GatewayControl {
  constructor(
    private readonly control: M1ControlPlaneService,
    private readonly repository: M1Repository,
  ) {}

  admit(
    principal: Principal,
    profileRef: string,
    inputDigest: string,
    idempotencyKey: string,
  ) {
    return this.control.admit(
      principal,
      { profileRef, inputDigest },
      idempotencyKey,
    );
  }
  async cancel(
    principal: Principal,
    executionId: string,
    reason: string | null,
  ) {
    await this.control.cancelExecution(principal, executionId, reason);
  }

  async recordUsage(
    claim: GatewayClaim,
    providerRequestId: string | null,
    inputTokens: number | null,
    outputTokens: number | null,
  ) {
    const complete = inputTokens !== null && outputTokens !== null;
    const cumulative = complete ? inputTokens + outputTokens : null;
    const sourceEventId =
      'provider-' +
      createHash('sha256')
        .update(providerRequestId ?? claim.invocationId)
        .digest('hex')
        .slice(0, 40);
    await this.repository.recordUsage(accountant, {
      executionId: claim.executionId,
      attemptId: claim.attemptId,
      sourceEventId,
      sourceRevision: 1,
      coverage: [claim.invocationId],
      cumulativeUnits: cumulative === null ? null : String(cumulative),
      completeness: complete ? 'complete' : 'unknown',
      costBasis: complete ? 'provider_reported' : 'unknown',
      reason: complete
        ? 'Provider-reported gateway token usage.'
        : 'Provider did not return complete token usage.',
    });
  }
}
