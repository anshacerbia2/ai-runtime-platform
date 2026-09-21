import type { Principal } from '../domain/principal.js';
export interface PrincipalVerifier {
  verify(token: string): Promise<Principal | null>;
}
export const PRINCIPAL_VERIFIER = Symbol('PrincipalVerifier');
export interface ApplicationRegistry {
  resolveClient(clientId: string): Promise<string | null>;
}
