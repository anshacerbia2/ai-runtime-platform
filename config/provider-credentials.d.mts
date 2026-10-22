export interface ProviderCredentialConfiguration {
  readonly connectionId: string;
  readonly provider: 'openrouter' | 'direct-anthropic';
  readonly credentialRef: string;
  readonly apiKey: string;
}
export function captureProviderCredentialBindings(
  input: unknown,
): readonly ProviderCredentialConfiguration[];
export function parseProviderCredentialBindings(
  raw: unknown,
): readonly ProviderCredentialConfiguration[];
