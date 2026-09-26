import { timingSafeEqual } from 'node:crypto';
import type { PrincipalVerifier } from '../application/principal-verifier.port.js';
import type { CredentialVerifier } from '../application/credential-verifier.port.js';
import type { Principal } from '../domain/principal.js';

export class LocalPrincipalVerifier implements PrincipalVerifier {
  constructor(
    private readonly applications: CredentialVerifier,
    private readonly operatorToken?: string,
    private readonly runnerToken?: string,
  ) {}
  async verify(token: string): Promise<Principal | null> {
    if (
      this.operatorToken &&
      Buffer.byteLength(token) === Buffer.byteLength(this.operatorToken) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.operatorToken))
    ) {
      return {
        subject: 'local-operator',
        kind: 'operator',
        roles: ['platform-admin'],
        scopes: ['platform:read', 'platform:manage', 'usage:verify'],
      };
    }
    if (
      this.runnerToken &&
      Buffer.byteLength(token) === Buffer.byteLength(this.runnerToken) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.runnerToken))
    ) {
      return {
        subject: 'local-runner',
        kind: 'runner',
        roles: ['runtime-runner'],
        scopes: ['runner:register', 'runner:report'],
      };
    }
    const app = await this.applications.verify(token);
    return app
      ? {
          subject: app.applicationId,
          kind: 'application',
          applicationId: app.applicationId,
          roles: ['runtime-application'],
          scopes: [
            'execution:submit',
            'execution:read',
            'execution:cancel',
            'artifact:read',
            'artifact:write',
            'usage:read',
          ],
        }
      : null;
  }
}
