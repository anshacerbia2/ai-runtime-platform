import type { ApplicationIdentity } from '../domain/application-identity.js';

/** Replaceable credential boundary: local lab today, verified OIDC claims in M1. */
export interface CredentialVerifier {
  verify(credential: string): Promise<ApplicationIdentity | null>;
}

export const CREDENTIAL_VERIFIER = Symbol('CredentialVerifier');
