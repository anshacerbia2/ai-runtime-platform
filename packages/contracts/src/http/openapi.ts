import { z } from 'zod';
import { contractRoutes, responseSchema } from './routes.js';

/** Artifact generation only; clients use direct inference and never wait for codegen. */
export function httpOpenApi(router: object, title: string, version: string) {
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
    const responses = Object.fromEntries(
      Object.keys(route.responses).map((status) => {
        const schema = responseSchema(route, Number(status));
        return [
          status,
          {
            description:
              Number(status) < 400 ? 'Successful response' : 'Normalized error',
            ...(schema
              ? {
                  content: {
                    'application/json': {
                      schema: z.toJSONSchema(schema, { io: 'output' }),
                    },
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
  return { openapi: '3.1.0', info: { title, version }, paths };
}
