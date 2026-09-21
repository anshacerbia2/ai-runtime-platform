import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { ApplicationIdentity } from '../domain/application-identity.js';
import type { CredentialVerifier } from './credential-verifier.port.js';

export class AuthenticateApplication {
  constructor(private readonly credentials: CredentialVerifier) {}

  async execute(credential: string | undefined): Promise<ApplicationIdentity> {
    if (!credential || credential.length > 512) {
      throw new ApplicationError(
        'UNAUTHENTICATED',
        'Application credential required.',
      );
    }

    const identity = await this.credentials.verify(credential);
    if (!identity) {
      throw new ApplicationError(
        'UNAUTHENTICATED',
        'Invalid application credential.',
      );
    }

    return identity;
  }
}
