import {
  apiContract,
  browserContract,
  contractRoutes,
  matchRoute,
  responseSchema,
  unaryHttpPolicy,
  httpBehavior,
} from '@ai-runtime/contracts/http';
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
import { requestScope } from '../../shared/api/request-scope';
import {
  boundedResponseText,
  discardBody,
  ResponseReadError,
} from '../../shared/api/bounded-response';
import { retryAfterMs } from '../../shared/api/http-error';

const exposedRoutes = contractRoutes(browserContract);
const localRoutes = new Set(
  contractRoutes(apiContract.lab).map((route) => route.path),
);
const gatewayBrowserRoutes = new Set(
  contractRoutes(browserContract.gateway).map((route) => route.path),
);
const applicationBrowserRoutes = new Set([
  ...contractRoutes(browserContract.lab).map((route) => route.path),
  ...gatewayBrowserRoutes,
]);

/** Allow-listed unary BFF. No automatic retry and no inference of rollback. */
export async function forward(
  request: Request,
  segments: string[],
  runtime: WebRuntime,
  transport: typeof fetch = fetch,
): Promise<Response> {
  const { config } = runtime;
  const scope = requestScope(
    Math.min(config.requestTimeoutMs, unaryHttpPolicy.timeoutMs),
    request.signal,
  );
  const diagnostics = new Headers();
  let dispatched = false;
  try {
    scope.check();
    const mutation = !['GET', 'HEAD'].includes(request.method);
    guardBrowserRequest(request, config, mutation);
    if (
      segments.some(
        (segment) =>
          !/^[A-Za-z0-9_.:-]+$/.test(segment) ||
          segment === '.' ||
          segment === '..',
      )
    ) {
      throw new HttpFailure(404, 'NOT_FOUND');
    }
    const route = segments.join('/');
    const matches = matchRoute(exposedRoutes, '/api/' + route);
    if (!matches.length) {
      throw new HttpFailure(404, 'NOT_FOUND');
    }
    const endpoint = matches.find(
      (candidate) => candidate.method === request.method,
    );
    if (!endpoint) {
      throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    }
    if (!config.local && localRoutes.has(endpoint.path)) {
      throw new HttpFailure(404, 'LOCAL_LAB_DISABLED');
    }
    let token: string | null | undefined;
    if (config.local) {
      token = applicationBrowserRoutes.has(endpoint.path)
        ? config.applicationToken
        : config.operatorToken;
    } else {
      if (!config.hosting || !runtime.sessions) {
        throw new HttpFailure(503, 'SESSION_STORE_UNAVAILABLE');
      }
      token = await scope.wait(
        runtime.sessions.access(
          cookieValue(request, config.hosting.cookieName),
        ),
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
      body = await scope.wait(
        boundedBody(request.body, config.bodyLimitBytes, scope.signal),
      );
    }
    const browserPath = '/api/' + route;
    const upstreamPath = gatewayBrowserRoutes.has(endpoint.path)
      ? browserPath.slice('/api'.length)
      : browserPath;
    const url = new URL(upstreamPath, config.apiOrigin);
    url.search = new URL(request.url).search;
    const wantsStream =
      request.headers
        .get('accept')
        ?.toLowerCase()
        .includes('text/event-stream') === true;
    const headers = new Headers({
      Authorization: 'Bearer ' + token,
      Accept: wantsStream ? 'text/event-stream' : 'application/json',
    });
    if (mutation) {
      headers.set('Content-Type', 'application/json');
    }
    const key = request.headers.get('idempotency-key');
    if (key) {
      headers.set('Idempotency-Key', key);
    }
    scope.check();
    dispatched = true;
    const response = await scope.wait(
      transport(url, {
        method: request.method,
        headers,
        body: body as BodyInit | undefined,
        cache: 'no-store',
        redirect: 'error',
        signal: scope.signal,
      }).then((result) => {
        if (scope.signal.aborted) {
          discardBody(result);
          scope.check();
        }
        return result;
      }),
    );
    const requestId = response.headers.get('x-request-id');
    if (requestId && requestId.length <= 200) {
      diagnostics.set('X-Request-ID', requestId);
    }
    const delay = retryAfterMs(response.headers.get('retry-after'));
    if (delay !== undefined) {
      diagnostics.set('Retry-After', String(Math.ceil(delay / 1000)));
    }
    if (
      response.ok &&
      wantsStream &&
      response.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('text/event-stream')
    ) {
      if (!response.body) {
        throw new HttpFailure(502, 'INVALID_UPSTREAM_RESPONSE');
      }
      const outputHeaders = new Headers(safeHeaders);
      outputHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
      outputHeaders.set('Cache-Control', 'no-store, no-transform');
      outputHeaders.set('X-Accel-Buffering', 'no');
      diagnostics.forEach((value, name) => outputHeaders.set(name, value));
      // Stream the API's normalized SSE frames; do not buffer the response in the BFF.
      return new Response(response.body, {
        status: response.status,
        headers: outputHeaders,
      });
    }
    if (response.status >= 500) {
      discardBody(response);
      // Preserve overload/deadline semantics without forwarding server diagnostics.
      throw new HttpFailure(
        response.status === 503 || response.status === 504
          ? response.status
          : 502,
        'UPSTREAM_UNAVAILABLE',
      );
    }
    const mediaType = response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      discardBody(response);
      throw new HttpFailure(502, 'INVALID_UPSTREAM_RESPONSE');
    }
    const schema = responseSchema(endpoint, response.status);
    if (!schema) {
      discardBody(response);
      throw new HttpFailure(502, 'INVALID_UPSTREAM_RESPONSE');
    }
    let data: unknown;
    try {
      const text = await boundedResponseText(
        response,
        Math.min(
          config.responseLimitBytes,
          httpBehavior(endpoint).maxResponseBytes,
        ),
        scope,
      );
      data = JSON.parse(text);
    } catch (error) {
      if (error instanceof ResponseReadError) {
        throw new HttpFailure(
          502,
          error.code === 'RESPONSE_TOO_LARGE'
            ? 'UPSTREAM_RESPONSE_TOO_LARGE'
            : 'INVALID_UPSTREAM_RESPONSE',
        );
      }
      if (error instanceof SyntaxError) {
        throw new HttpFailure(502, 'INVALID_UPSTREAM_RESPONSE');
      }
      throw error;
    }
    const checked = schema.safeParse(data);
    if (!checked.success) {
      throw new HttpFailure(502, 'INVALID_UPSTREAM_RESPONSE');
    }
    scope.check();
    const outputHeaders = new Headers(safeHeaders);
    outputHeaders.set('Content-Type', 'application/json; charset=utf-8');
    diagnostics.forEach((value, name) => outputHeaders.set(name, value));
    // Reprojection here is intentional: no credentials or uncontracted fields cross the BFF.
    return new Response(JSON.stringify(checked.data), {
      status: response.status,
      headers: outputHeaders,
    });
  } catch (error) {
    const timedOut =
      scope.signal.aborted &&
      scope.signal.reason instanceof Error &&
      scope.signal.reason.name === 'TimeoutError';
    const result = failure(
      timedOut
        ? new HttpFailure(dispatched ? 504 : 408, 'REQUEST_TIMEOUT')
        : error,
    );
    diagnostics.forEach((value, name) => result.headers.set(name, value));
    return result;
  } finally {
    scope.dispose();
  }
}
