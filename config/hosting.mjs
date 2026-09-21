/** Pure deployment contract, shared by server, Vite and invariant tests. */
export function hostingContract(input) {
  const origin = new URL(input.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== input.publicOrigin) {
    throw new Error('Public origin must be an exact HTTPS origin.');
  }
  if (
    !/^[a-z][a-z0-9-]{1,62}$/.test(input.appId) ||
    input.clientId !== `${input.appId}-app`
  ) {
    throw new Error('A dedicated confidential app client is required.');
  }
  const mountPath = `/apps/${input.appId}/app`;
  const base = input.publicOrigin + mountPath;
  if (
    input.callbackUri !== base + '/auth/callback' ||
    input.logoutUri !== base + '/auth/logged-out'
  ) {
    throw new Error(
      'Registered callback/logout URI does not match the public mount.',
    );
  }
  if (input.proxySecret.length < 32 || !input.clientSecret) {
    throw new Error(
      'Proxy credential and confidential client secret are required.',
    );
  }
  return Object.freeze({
    ...input,
    mountPath,
    cookieName: `__Secure-${input.clientId}-session`,
    cookiePath: mountPath,
    cookieSecure: true,
    cookieHttpOnly: true,
    cookieSameSite: 'Lax',
    frameAncestors: input.publicOrigin,
  });
}
