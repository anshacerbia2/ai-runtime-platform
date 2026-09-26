import { z } from 'zod';
import { httpBehavior } from './behavior.js';
import { apiContract, contractRoutes, responseSchema } from './routes.js';
import { responseEvolutionPolicy } from './response-policy.js';

export interface HttpOpenApiOptions {
  boundary?: 'provider' | 'browser';
  sessionCookieName?: string;
}

/** Artifact generation only; clients use direct inference and never wait for codegen. */
export function httpOpenApi(
  router: object,
  title: string,
  version: string,
  options: HttpOpenApiOptions = {},
) {
  const browser = options.boundary === 'browser';
  const security = browser
    ? [{ BrowserSession: [] }]
    : [{ PlatformBearer: [] }];
  const securitySchemes = browser
    ? {
        BrowserSession: {
          type: 'apiKey',
          in: options.sessionCookieName ? 'cookie' : 'header',
          name: options.sessionCookieName ?? 'Cookie',
          description:
            'Opaque server-owned session. Browsers send it with same-origin credentials; never expose access/refresh tokens. Without a deployment cookie name this scheme describes the complete Cookie header. Local M0 mode injects test principals server-side and is not the deployment authentication model.',
          'x-cookie-name-template': '__Host-{M1_APP_ID}-session',
        },
      }
    : {
        PlatformBearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Platform principal credential, never a provider API key. Application/operator/runner kind, scopes and resource authorization are enforced separately by the API.',
        },
      };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of contractRoutes(router)) {
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const parameters: unknown[] = [];
    for (const [key, location] of [
      ['pathParams', 'path'],
      ['query', 'query'],
      ['headers', 'header'],
    ] as const) {
      const schema = Reflect.get(route, key);
      if (schema instanceof z.ZodType) {
        const document = z.toJSONSchema(schema, { io: 'input' });
        for (const [name, item] of Object.entries(document.properties ?? {})) {
          parameters.push({
            name,
            in: location,
            required:
              location === 'path' || document.required?.includes(name) === true,
            schema: item,
          });
        }
      }
    }
    const body =
      'body' in route && route.body instanceof z.ZodType
        ? route.body
        : undefined;
    const metadata = route.metadata as
      | {
          responseMode?: 'json-or-sse' | 'sse';
          sse?: boolean;
          deprecated?: boolean;
          replacement?: string;
        }
      | undefined;
    const responses = Object.fromEntries(
      Object.keys(route.responses).map((status) => {
        const schema = responseSchema(route, Number(status));
        const success = Number(status) < 400;
        const sse = success && metadata?.sse === true;
        const json = schema && metadata?.responseMode !== 'sse';
        return [
          status,
          {
            description:
              Number(status) < 400 ? 'Successful response' : 'Normalized error',
            headers: {
              'X-Request-ID': {
                description:
                  'Server correlation ID when available; not an idempotency key or authority token.',
                schema: { type: 'string', maxLength: 200 },
              },
              ...([429, 503, 504].includes(Number(status))
                ? {
                    'Retry-After': {
                      description:
                        'Optional minimum retry delay hint; does not grant replay permission.',
                      schema: { type: 'string' },
                    },
                  }
                : {}),
            },
            ...(json || sse
              ? {
                  content: {
                    ...(json
                      ? {
                          'application/json': {
                            // Describe consumer acceptance, not a producer-only closed projection.
                            schema: z.toJSONSchema(schema!, { io: 'input' }),
                          },
                        }
                      : {}),
                    ...(sse
                      ? {
                          'text/event-stream': {
                            schema: { type: 'string' },
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        ];
      }),
    );
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      operationId:
        route.method.toLowerCase() + route.path.replace(/[^A-Za-z0-9]/g, '_'),
      'x-runtime-behavior': httpBehavior(route),
      'x-provider-unknown-fields':
        responseEvolutionPolicy.providerUnknownFields,
      'x-consumer-unknown-fields':
        responseEvolutionPolicy.consumerUnknownFields,
      'x-response-mutation': responseEvolutionPolicy.responseMutation,
      ...(metadata?.sse ? { 'x-streaming': 'server-sent-events' } : {}),
      ...(metadata?.deprecated
        ? {
            deprecated: true,
            ...(metadata.replacement
              ? { 'x-replacement': metadata.replacement }
              : {}),
          }
        : {}),
      security: route.path === apiContract.live.path ? [] : security,
      ...(route.path.startsWith('/api/m0/') ? { 'x-local-only': true } : {}),
      ...([
        apiContract.controlPlane.snapshot.path,
        apiContract.controlPlane.audit.path,
        apiContract.controlPlane.outbox.path,
      ].some((path) => path === route.path)
        ? {
            deprecated: true,
            'x-replacement-scope':
              'Use matching /api/v1 resource operations where available. Legacy admission/accounting calls remain supported until their runtime successor is implemented.',
          }
        : {}),
      parameters,
      ...(body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: z.toJSONSchema(body, { io: 'input' }),
                },
              },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: { title, version },
    security,
    components: { securitySchemes },
    paths,
  };
}
