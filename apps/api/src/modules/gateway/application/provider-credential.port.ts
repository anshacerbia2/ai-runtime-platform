import type { ProviderId } from './provider-adapter.port.js';

export interface ProviderCredentialBinding {
  readonly applicationId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly invocationId: string;
  readonly ownerInstanceId: string;
  readonly connectionId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly provider: ProviderId;
  readonly credentialRef: string;
}

export interface ProviderCredentialResolver {
  resolve(
    binding: ProviderCredentialBinding,
    signal: AbortSignal,
  ): Promise<string>;
}

export interface ProviderCredentialAuthority {
  authorizeCredential(binding: ProviderCredentialBinding): Promise<boolean>;
}

export const PROVIDER_CREDENTIAL_RESOLVER = Symbol(
  'ProviderCredentialResolver',
);
