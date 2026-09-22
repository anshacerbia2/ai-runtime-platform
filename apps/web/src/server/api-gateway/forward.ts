import 'server-only';
import type { WebRuntime } from '../runtime';
import {
  boundedBody,
  cookieValue,
  failure,
  guardBrowserRequest,
  HttpFailure,
  safeHeaders,
} from '../http/security';

const resources: ReadonlyArray<[RegExp, readonly string[]]> = [
  [/^m0\/(health|profiles|examples|contracts|openapi\.json|history)$/, ['GET']],
  [/^m0\/history\/[a-f0-9-]+$/, ['GET']],
  [/^m0\/validations$/, ['POST']],
  [/^m1\/control-plane$/, ['GET', 'PUT']],
  [/^m1\/(audit|outbox)$/, ['GET']],
  [/^m1\/(admissions|usage|artifacts)$/, ['POST']],
  [/^m1\/executions\/[a-f0-9-]+$/, ['GET']],
  [/^m1\/executions\/[a-f0-9-]+\/cancel$/, ['POST']],
];

/** An allow-listed forwarding boundary; domain authorization stays in NestJS. */
export async function forward(
  request: Request,
  segments: string[],
  runtime: WebRuntime,
  transport: typeof fetch = fetch,
): Promise<Response> {
  try {
    const { config } = runtime;
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(config.requestTimeoutMs),
    ]);
    const mutation = !['GET', 'HEAD'].includes(request.method);
    guardBrowserRequest(request, config, mutation);
    if (
      segments.some(
        (segment) =>
          !/^[A-Za-z0-9_.-]+$/.test(segment) ||
          segment === '.' ||
          segment === '..',
      )
    ) {
      throw new HttpFailure(404, 'NOT_FOUND');
    }
    const route = segments.join('/');
    const match = resources.find(([pattern]) => pattern.test(route));
    if (!match) {
      throw new HttpFailure(404, 'NOT_FOUND');
    }
    if (!match[1].includes(request.method)) {
      throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    }
    if (!config.local && route.startsWith('m0/')) {
      throw new HttpFailure(404, 'LOCAL_LAB_DISABLED');
    }
    let token: string | null | undefined;
    if (config.local) {
      token = route.startsWith('m1/')
        ? config.operatorToken
        : config.applicationToken;
    } else {
      if (!config.hosting || !runtime.sessions) {
        throw new HttpFailure(503, 'SESSION_STORE_UNAVAILABLE');
      }
      token = await runtime.sessions.access(
        cookieValue(request, config.hosting.cookieName),
      );
    }
    if (!token) {
      throw new HttpFailure(401, 'AUTHENTICATION_REQUIRED');
    }
    let body: Uint8Array | undefined;
    if (mutation) {
      if (
        request.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase() !== 'application/json'
      ) {
        throw new HttpFailure(415, 'JSON_REQUIRED');
      }
      if (
        Number(request.headers.get('content-length')) > config.bodyLimitBytes
      ) {
        throw new HttpFailure(413, 'PAYLOAD_TOO_LARGE');
      }
      body = await boundedBody(request.body, config.bodyLimitBytes, signal);
    }
    const url = new URL('/api/' + route, config.apiOrigin);
    url.search = new URL(request.url).search;
    const headers = new Headers({
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
    });
    if (mutation) {
      headers.set('Content-Type', 'application/json');
    }
    const key = request.headers.get('idempotency-key');
    if (key) {
      headers.set('Idempotency-Key', key);
    }
    const response = await transport(url, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    if (response.status >= 500) {
      await response.body?.cancel();
      throw new HttpFailure(502, 'UPSTREAM_UNAVAILABLE');
    }
    const outputHeaders = new Headers(safeHeaders);
    outputHeaders.set('Content-Type', 'application/json; charset=utf-8');
    const requestId = response.headers.get('x-request-id');
    if (requestId) {
      outputHeaders.set('X-Request-ID', requestId);
    }
    if (response.status === 204) {
      return new Response(null, { status: 204, headers: outputHeaders });
    }
    const mediaType = response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      await response.body?.cancel();
      throw new HttpFailure(502, 'INVALID_UPSTREAM_RESPONSE');
    }
    const bytes = await boundedBody(
      response.body,
      config.responseLimitBytes,
      signal,
    );
    // Cookie, proxy, Authorization, Location and arbitrary browser headers never transit this boundary.
    return new Response(bytes as BodyInit, {
      status: response.status,
      headers: outputHeaders,
    });
  } catch (error) {
    return failure(error);
  }
}
