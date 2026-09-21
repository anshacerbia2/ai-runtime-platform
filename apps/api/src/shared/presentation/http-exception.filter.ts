import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from '../domain/application-error.js';

const errorStatus = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  RESOURCE_EXHAUSTED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
} as const;

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    if (response.sent) {
      return;
    }

    let status = 503;
    let code = 'DEPENDENCY_UNAVAILABLE';
    let message =
      'Local dependency unavailable. No validation was confirmed saved.';

    if (error instanceof ApplicationError) {
      code = error.code;
      status = errorStatus[error.code];
      message = error.message;
    } else {
      const declaredStatus =
        error instanceof HttpException
          ? error.getStatus()
          : typeof error === 'object' && error && 'statusCode' in error
            ? Number(error.statusCode)
            : undefined;
      if (declaredStatus === 400 || declaredStatus === 413) {
        status = declaredStatus;
        code = 'INVALID_REQUEST';
        message =
          status === 413
            ? 'Payload exceeds 64 KiB.'
            : 'Malformed JSON request.';
      } else if (declaredStatus === 404) {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Endpoint tidak tersedia.';
      }
    }
    if (status === 503) {
      request.log.error({ code }, 'Request dependency failure');
    }
    response.code(status).send({
      error: {
        code,
        message,
        retryable: status === 503,
        request_id: request.id,
        execution_id: null,
      },
    });
  }
}
