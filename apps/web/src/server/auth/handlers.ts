import 'server-only';
import type { WebRuntime } from '../runtime';
import {
  cookieValue,
  failure,
  guardBrowserRequest,
  HttpFailure,
  safeHeaders,
  sessionCookie,
} from '../http/security';

const destinations = new Set([
  '/contract-lab',
  '/control-plane',
  '/history',
  '/schemas',
  '/delivery-plan',
  '/docs',
]);

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ ...safeHeaders, Location: location });
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(null, { status: 303, headers });
};

export async function login(
  request: Request,
  runtime: WebRuntime,
): Promise<Response> {
  try {
    guardBrowserRequest(request, runtime.config, true);
    if (runtime.config.local) {
      return redirect(runtime.config.publicOrigin + '/contract-lab');
    }
    const { hosting, auth } = runtime.config;
    if (!hosting || !auth || !runtime.sessions || !runtime.identity) {
      throw new HttpFailure(503, 'AUTH_UNAVAILABLE');
    }
    const requested = new URL(request.url).searchParams.get('returnTo');
    const returnTo =
      requested && destinations.has(requested) ? requested : '/control-plane';
    const result = await runtime.identity.authorize(returnTo);
    const reference = await runtime.sessions.login(result.flow);
    return redirect(result.url, [
      sessionCookie(
        hosting.cookieName + '-login',
        reference,
        auth.loginTtlSeconds,
      ),
    ]);
  } catch (error) {
    return failure(error);
  }
}

export async function callback(
  request: Request,
  runtime: WebRuntime,
): Promise<Response> {
  const { hosting, auth, publicOrigin } = runtime.config;
  if (!hosting || !auth || !runtime.sessions || !runtime.identity) {
    return failure(new HttpFailure(400, 'OIDC_DISABLED'));
  }
  const clearFlow = sessionCookie(hosting.cookieName + '-login', '', 0);
  try {
    // OIDC top-level callbacks are intentionally cross-site; state+PKCE+nonce bind this hop.
    const host = request.headers.get('host') ?? new URL(request.url).host;
    if (host !== new URL(publicOrigin).host) {
      throw new HttpFailure(403, 'HOST_DENIED');
    }
    const reference = cookieValue(request, hosting.cookieName + '-login');
    const flow = await runtime.sessions.consumeLogin(reference);
    if (!flow || !destinations.has(flow.returnTo)) {
      throw new Error('Invalid login transaction.');
    }
    const url = new URL(hosting.callbackUri);
    url.search = new URL(request.url).search;
    const result = await runtime.identity.exchange(url, flow);
    // Replace any old reference so signing in can never fixate a previous session.
    await runtime.sessions.logout(cookieValue(request, hosting.cookieName));
    const session = await runtime.sessions.create(result.tokens, result.user);
    return redirect(publicOrigin + flow.returnTo, [
      clearFlow,
      sessionCookie(hosting.cookieName, session, auth.sessionTtlSeconds),
    ]);
  } catch {
    return redirect(publicOrigin + '/?signIn=failed', [clearFlow]);
  }
}

export async function logout(
  request: Request,
  runtime: WebRuntime,
): Promise<Response> {
  try {
    guardBrowserRequest(request, runtime.config, true);
    const hosting = runtime.config.hosting;
    if (hosting && runtime.sessions) {
      await runtime.sessions.logout(cookieValue(request, hosting.cookieName));
      return redirect(hosting.logoutUri, [
        sessionCookie(hosting.cookieName, '', 0),
        sessionCookie(hosting.cookieName + '-login', '', 0),
      ]);
    }
    return redirect(runtime.config.publicOrigin + '/auth/logged-out');
  } catch (error) {
    return failure(error);
  }
}
