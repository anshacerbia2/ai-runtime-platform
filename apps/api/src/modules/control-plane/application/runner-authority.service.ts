import type {
  AssignCommand,
  RevokeCommand,
  RunnerReport,
  LateEvidence,
} from '@ai-runtime/contracts/http';
import type { Principal } from '../../identity/domain/principal.js';
import { requireAuthority } from '../../identity/domain/principal.js';
import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { RunnerAuthority } from './runner-authority.port.js';
import type { RunnerLeaseService } from './runner-lease.service.js';
export class RunnerAuthorityService {
  constructor(
    private readonly authority: RunnerAuthority,
    private readonly leases?: RunnerLeaseService,
  ) {}
  private key(key: string) {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
      throw new ApplicationError(
        'INVALID_REQUEST',
        'A valid request key is required.',
      );
    }
    return key;
  }
  grant(p: Principal, id: string, c: AssignCommand, key: string) {
    requireAuthority(p, 'platform:manage');
    return this.authority.grant(p, id, c, this.key(key));
  }
  revoke(p: Principal, id: string, c: RevokeCommand, key: string) {
    requireAuthority(p, 'platform:manage');
    return this.authority.revoke(p, id, c, this.key(key));
  }
  protocol(p: Principal) {
    requireAuthority(p, 'runner:register');
    return {
      version: '1',
      binding: 'bounded-http-json',
      authority: 'durable-generation',
      maxMessageBytes: 65536,
      executionDispatch: true,
      automaticReassignment: false,
      heartbeatIntervalMs: 5000,
      presenceTtlMs: 15000,
    } as const;
  }
  async report(p: Principal, r: RunnerReport) {
    requireAuthority(p, 'runner:report');
    if (r.lease) {
      if (!this.leases) {
        throw new ApplicationError(
          'DEPENDENCY_UNAVAILABLE',
          'Runner lease coordination is unavailable.',
        );
      }
      await this.leases.validateReport(p, r);
    }
    return this.authority.report(p, r);
  }
  evidence(p: Principal, e: LateEvidence) {
    requireAuthority(p, 'runner:report');
    return this.authority.evidence(p, e);
  }
}
