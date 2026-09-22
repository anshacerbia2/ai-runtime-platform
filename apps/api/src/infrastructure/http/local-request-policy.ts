import type { FastifyInstance } from 'fastify';
import type { RuntimeConfig } from '../config/environment-config.js';

/**
 * Transport policy only. Global principal guards still enforce JWT and roles.
 * ADR-0025/0026: the BFF forwards the user's bearer token, not a proxy secret.
 */
export function registerLocalRequestPolicy(
  server: FastifyInstance,
  config: RuntimeConfig,
) {
  const allowedHosts = new Set(config.allowedHosts);
  const allowedOrigins = new Set(config.allowedOrigins);
  server.addHook('onRequest', async (request, response) => {
    response
      .header('X-Request-ID', request.id)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "frame-ancestors 'none'")
      .header('X-Frame-Options', 'DENY');
    let host: string | undefined;
    try {
      host = new URL('http://' + request.headers.host).hostname;
    } catch {
      host = undefined;
    }
    if (
      !host ||
      !allowedHosts.has(host) ||
      (request.headers.origin && !allowedOrigins.has(request.headers.origin))
    ) {
      return response.code(403).send({
        error: {
          code: 'POLICY_DENIED',
          message: 'Request origin is not allowed.',
          retryable: false,
          request_id: request.id,
          execution_id: null,
        },
      });
    }
    if (
      config.runtimeMode === 'm1-oidc' &&
      request.url.startsWith('/api/m0/')
    ) {
      return response.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    // No request is authenticated by this hook; the identity guard owns that.
  });
}
