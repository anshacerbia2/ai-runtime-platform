import {
  applyDecorators,
  RequestMapping,
  RequestMethod,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map } from 'rxjs';
import { z } from 'zod';
import {
  ContractNoBody,
  responseSchema,
  type AppRoute,
} from '@ai-runtime/contracts/http';
import { ApplicationError } from '../domain/application-error.js';

export class ResponseContractError extends Error {
  constructor() {
    super('Provider response contract violation.');
    this.name = 'ResponseContractError';
  }
}

export class ContractInterceptor implements NestInterceptor {
  constructor(private readonly route: AppRoute) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const fields = [
      ['pathParams', request.params],
      ['query', request.query],
      ['headers', request.headers],
      ['body', request.body],
    ] as const;

    for (const [field, value] of fields) {
      const schema =
        field in this.route ? Reflect.get(this.route, field) : undefined;
      if (schema instanceof z.ZodType && !schema.safeParse(value).success) {
        throw new ApplicationError(
          field === 'pathParams' &&
            this.route.metadata &&
            typeof this.route.metadata === 'object' &&
            'invalidPathIsNotFound' in this.route.metadata &&
            this.route.metadata.invalidPathIsNotFound === true
            ? 'NOT_FOUND'
            : 'INVALID_REQUEST',
          'Request does not match the endpoint contract.',
        );
      }
    }

    return next.handle().pipe(
      map((value: unknown) => {
        // A hijacked Fastify reply owns its streaming wire validation/framing.
        // Request validation above still came from the shared contract.
        if (response.sent) {
          return value;
        }
        if (this.route.responses[response.statusCode] === ContractNoBody) {
          if (value !== undefined) {
            throw new ResponseContractError();
          }
          return undefined;
        }
        const schema = responseSchema(this.route, response.statusCode);
        // Presenters/repository mappers already return wire DTOs (ISO dates,
        // decimal strings). Do not serialize and reparse the entire response.
        const result = schema?.safeParse(value);
        if (!result?.success) {
          // Never leak invalid response fields or validation diagnostics to callers.
          throw new ResponseContractError();
        }
        return result.data;
      }),
    );
  }
}

/** Small Nest 12 binding; routing and validation come from the shared ts-rest contract. */
export function ContractRoute(route: AppRoute): MethodDecorator {
  return applyDecorators(
    RequestMapping({ path: route.path, method: RequestMethod[route.method] }),
    UseInterceptors(new ContractInterceptor(route)),
  );
}
