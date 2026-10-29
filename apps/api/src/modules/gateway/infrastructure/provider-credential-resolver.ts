import {
  captureProviderCredentialBindings,
  type ProviderCredentialConfiguration,
} from '../../../../../../config/provider-credentials.mjs';
import {
  ProviderError,
  type ProviderId,
  type ProviderRequest,
} from '../application/provider-adapter.port.js';
import type {
  ProviderCredentialAuthority,
  ProviderCredentialBinding,
  ProviderCredentialResolver,
} from '../application/provider-credential.port.js';

const unavailable = (provider: ProviderId) =>
  new ProviderError(provider, 'PROVIDER_CREDENTIAL_UNAVAILABLE', 'not-sent');
const aborted = () =>
  new DOMException('Provider credential lookup aborted.', 'AbortError');
const keys = [
  'applicationId',
  'executionId',
  'attemptId',
  'invocationId',
  'ownerInstanceId',
  'connectionId',
  'credentialId',
  'credentialRef',
] as const;
function capture(value: ProviderCredentialBinding): ProviderCredentialBinding {
  if (
    !value ||
    !['openrouter', 'direct-anthropic'].includes(value.provider) ||
    !Number.isSafeInteger(value.credentialRevision) ||
    value.credentialRevision < 1 ||
    keys.some(
      (key) =>
        typeof value[key] !== 'string' ||
        !value[key] ||
        value[key].length > 512 ||
        Array.from(value[key]).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    )
  ) {
    throw new Error('Invalid provider credential binding.');
  }
  return Object.freeze({
    ...Object.fromEntries(keys.map((key) => [key, value[key]])),
    credentialRevision: value.credentialRevision,
    provider: value.provider,
  }) as unknown as ProviderCredentialBinding;
}

/** Initial deployment-injected source; production secret-manager selection remains O14. */
export class ConfiguredProviderCredentialSource implements ProviderCredentialResolver {
  readonly #entries: readonly ProviderCredentialConfiguration[];
  readonly #legacy: Readonly<{
    openrouterApiKey?: string;
    anthropicApiKey?: string;
  }>;
  constructor(
    entries: readonly ProviderCredentialConfiguration[],
    legacy: { openrouterApiKey?: string; anthropicApiKey?: string } = {},
  ) {
    this.#entries = captureProviderCredentialBindings(entries);
    this.#legacy = Object.freeze({ ...legacy });
  }
  async resolve(
    binding: ProviderCredentialBinding,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) {
      throw aborted();
    }
    const entry = this.#entries.find(
      (value) =>
        value.connectionId === binding.connectionId &&
        value.provider === binding.provider &&
        value.credentialRef === binding.credentialRef,
    );
    if (entry) {
      return entry.apiKey;
    }
    // Only the trusted local composition supplies these compatibility slots.
    const legacy =
      binding.provider === 'openrouter' &&
      binding.credentialRef === 'env:M2_OPENROUTER_API_KEY'
        ? this.#legacy.openrouterApiKey
        : binding.provider === 'direct-anthropic' &&
            binding.credentialRef === 'env:M2_ANTHROPIC_API_KEY'
          ? this.#legacy.anthropicApiKey
          : undefined;
    if (!legacy) {
      throw unavailable(binding.provider);
    }
    return legacy;
  }
}

/** Keep both authorization checks outside source lookup; source success is not authority. */
export class RegistryProviderCredentialResolver implements ProviderCredentialResolver {
  constructor(
    private readonly authority: ProviderCredentialAuthority,
    private readonly source: ProviderCredentialResolver,
  ) {}
  async resolve(
    binding: ProviderCredentialBinding,
    signal: AbortSignal,
  ): Promise<string> {
    const value = capture(binding);
    try {
      if (signal.aborted) {
        throw aborted();
      }
      if (
        !(await this.authority.authorizeCredential(value)) ||
        signal.aborted
      ) {
        throw unavailable(value.provider);
      }
      const key = await this.source.resolve(value, signal);
      if (
        signal.aborted ||
        !(await this.authority.authorizeCredential(value)) ||
        signal.aborted
      ) {
        throw unavailable(value.provider);
      }
      return key;
    } catch {
      if (signal.aborted) {
        throw aborted();
      }
      throw unavailable(value.provider);
    }
  }
}

/** Legacy string sources are programmatic/local compatibility, never production wiring. */
export async function resolveAdapterCredential(
  source: string | ProviderCredentialResolver | undefined,
  provider: ProviderId,
  request: ProviderRequest,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) {
    throw aborted();
  }
  if (typeof source === 'string' || source === undefined) {
    const ref =
      provider === 'openrouter'
        ? 'env:M2_OPENROUTER_API_KEY'
        : 'env:M2_ANTHROPIC_API_KEY';
    if (request.credentialRef !== ref) {
      throw new ProviderError(
        provider,
        'PROVIDER_CREDENTIAL_REF_UNSUPPORTED',
        'not-sent',
      );
    }
    if (!source || !/^[\x21-\x7e]{1,8192}$/.test(source)) {
      throw unavailable(provider);
    }
    return source;
  }
  let binding: ProviderCredentialBinding;
  try {
    binding = capture(request.credentialBinding!);
    if (
      binding.provider !== provider ||
      binding.credentialRef !== request.credentialRef
    ) {
      throw unavailable(provider);
    }
  } catch {
    throw unavailable(provider);
  }
  // Bound even an uncooperative external secret source by the existing request signal.
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve()
      .then(() => {
        if (signal.aborted) {
          throw aborted();
        }
        return source.resolve(binding, signal);
      })
      .then((key) => {
        if (signal.aborted) {
          throw aborted();
        }
        if (typeof key !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(key)) {
          throw unavailable(provider);
        }
        resolve(key);
      })
      .catch(() => reject(signal.aborted ? aborted() : unavailable(provider)))
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}
