const invalid = () => new Error('Invalid M2_PROVIDER_CREDENTIALS_JSON.');
const text = (value, maximum) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maximum &&
  value.trim() === value &&
  !Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );

/** Explicit deployment-owned bindings; never looks up arbitrary process.env names. */
export function captureProviderCredentialBindings(input) {
  if (!Array.isArray(input) || input.length > 64) {
    throw invalid();
  }
  const seen = new Set();
  const captured = Array.from(input, (entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !==
        'apiKey,connectionId,credentialRef,provider' ||
      !text(entry.connectionId, 160) ||
      !text(entry.credentialRef, 512) ||
      !['openrouter', 'direct-anthropic'].includes(entry.provider) ||
      typeof entry.apiKey !== 'string' ||
      !/^[\x21-\x7e]{1,8192}$/.test(entry.apiKey)
    ) {
      throw invalid();
    }
    const key = JSON.stringify([
      entry.connectionId,
      entry.provider,
      entry.credentialRef,
    ]);
    if (seen.has(key)) {
      throw invalid();
    }
    seen.add(key);
    return Object.freeze({
      connectionId: entry.connectionId,
      provider: entry.provider,
      credentialRef: entry.credentialRef,
      apiKey: entry.apiKey,
    });
  });
  return Object.freeze(captured);
}

export function parseProviderCredentialBindings(raw) {
  if (raw === undefined || raw === '') {
    return Object.freeze([]);
  }
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 65536) {
      throw invalid();
    }
    return captureProviderCredentialBindings(JSON.parse(raw));
  } catch {
    // Never include the parser error, offending value or secret in configuration errors.
    throw invalid();
  }
}
