import { createHash } from 'node:crypto';
import {
  canonicalJson,
  describePayload,
  validateContract,
  withinPayloadBudget,
} from '@ai-runtime/contracts';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ContractPolicy } from '../application/ports/contract-policy.port.js';
import type { ContractKind, ProfileType } from '../domain/validation-record.js';

export class ZodContractPolicy implements ContractPolicy {
  prepare(kind: ContractKind, payload: unknown, profiles: ProfileType[]) {
    if (!withinPayloadBudget(payload)) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'Payload exceeds M0 depth/node limits.',
      );
    }
    return {
      report: validateContract(kind, payload, profiles),
      requestSummary: describePayload(payload),
      requestDigest: createHash('sha256')
        .update(canonicalJson({ kind, payload }))
        .digest('hex'),
    };
  }
}
