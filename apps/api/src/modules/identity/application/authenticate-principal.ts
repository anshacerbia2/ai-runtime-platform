import { ApplicationError } from '../../../shared/domain/application-error.js';
import type { PrincipalVerifier } from './principal-verifier.port.js';

export class AuthenticatePrincipal {
  constructor(private readonly verifier: PrincipalVerifier) {}
  async execute(token: string | undefined) {
    if (!token || token.length > 16384) {
      throw new ApplicationError(
        'UNAUTHENTICATED',
        'Bearer credential required.',
      );
    }
    const principal = await this.verifier.verify(token);
    if (!principal) {
      throw new ApplicationError(
        'UNAUTHENTICATED',
        'Invalid bearer credential.',
      );
    }
    return principal;
  }
}
