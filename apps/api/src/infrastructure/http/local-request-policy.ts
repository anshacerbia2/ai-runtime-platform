import type { FastifyInstance } from 'fastify';
import type { LocalConfig } from '../config/local-config.js';

/** Transport-only local guard. It is not an OIDC or production access policy. */
export function registerLocalRequestPolicy(
  server: FastifyInstance,
  config: LocalConfig,
) {
  const allowedOrigins = new Set([
    `http://127.0.0.1:${config.webPort}`,
    `http://localhost:${config.webPort}`,
    `http://127.0.0.1:${config.apiPort}`,
  ]);
  server.addHook('onRequest', async (request, response) => {
    response
      .header('X-Request-ID', request.id)
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    const host = request.headers.host?.split(':')[0];
    const invalidHost = host && !['localhost', '127.0.0.1'].includes(host);
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
