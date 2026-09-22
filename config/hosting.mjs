/** Public deployment metadata only. No client secret is loaded by the API. */
export function hostingContract(input) {
  const origin = new URL(input.publicOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== input.publicOrigin ||
    origin.username ||
    origin.password
  ) {
    throw new Error('Public origin must be an exact HTTPS origin.');
  }
  if (
    !/^[a-z][a-z0-9-]{1,62}$/.test(input.appId) ||
    input.clientId !== input.appId + '-app'
  ) {
    throw new Error(
      'A dedicated per-environment confidential app client is required.',
    );
  }
  if (
    input.callbackUri !== input.publicOrigin + '/auth/callback' ||
    input.logoutUri !== input.publicOrigin + '/auth/logged-out'
  ) {
    throw new Error(
      'Callback/logout URI must match the standalone public origin exactly.',
    );
  }
  return Object.freeze({
    publicOrigin: input.publicOrigin,
    appId: input.appId,
    clientId: input.clientId,
    callbackUri: input.callbackUri,
    logoutUri: input.logoutUri,
    cookieName: '__Host-' + input.clientId + '-session',
    cookiePath: '/',
    cookieSecure: true,
    cookieHttpOnly: true,
    cookieSameSite: 'Lax',
    frameAncestors: "'none'",
  });
}
