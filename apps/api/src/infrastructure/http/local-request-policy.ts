import type { FastifyInstance } from 'fastify';
import type { RuntimeConfig } from '../config/environment-config.js';
import { timingSafeEqual } from 'node:crypto';

/** Transport-only local guard. It is not an OIDC or production access policy. */
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
      .header('X-Content-Type-Options', 'nosniff');
    if (config.hosting) {
      response.header(
        'Content-Security-Policy',
        `frame-ancestors ${config.hosting.frameAncestors}`,
      );
      if (request.url === '/health/live') {
        return;
      }
      const proxy = request.headers['x-ati-one-proxy'];
      const expected = Buffer.from(config.hosting.proxySecret);
      if (
        typeof proxy !== 'string' ||
        Buffer.byteLength(proxy) !== expected.length ||
        !timingSafeEqual(Buffer.from(proxy), expected)
      ) {
        return response.code(403).send({
          error: {
            code: 'POLICY_DENIED',
            message: 'Trusted proxy required.',
          },
        });
      }
      if (request.url.startsWith('/api/m0/')) {
        return response.code(404).send({ error: { code: 'NOT_FOUND' } });
      }
    }
    const host = request.headers.host?.split(':')[0];
    const invalidHost = host && !allowedHosts.has(host);
    const invalidOrigin =
      request.headers.origin && !allowedOrigins.has(request.headers.origin);
    if (invalidHost || invalidOrigin) {
      return response.code(403).send({
        error: {
          code: 'POLICY_DENIED',
          message: 'Local Contract Lab only.',
          retryable: false,
          request_id: request.id,
          execution_id: null,
        },
      });
    }
  });
}
