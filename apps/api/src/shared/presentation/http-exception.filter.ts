import type { ApiErrorResponse } from '@ai-runtime/contracts/http';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationError } from '../domain/application-error.js';
import { ResponseContractError } from './contract-route.js';

const errorStatus = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  REQUEST_KEY_EXPIRED: 410,
  STREAM_RESUME_EXPIRED: 410,
  STALE_ASSIGNMENT: 409,
  VERSION_UNSUPPORTED: 422,
  RESOURCE_EXHAUSTED: 429,
  EXECUTION_IN_PROGRESS: 409,
  UPSTREAM_REJECTED: 502,
  UPSTREAM_RATE_LIMITED: 429,
  STRUCTURED_OUTPUT_INVALID: 502,
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
    let executionId: string | null = null;
    let message =
      'The request outcome is not confirmed. Reconcile or replay the same idempotency key and payload.';

    if (error instanceof ResponseContractError) {
      status = 500;
      code = 'RESPONSE_CONTRACT_VIOLATION';
      message =
        'The service could not confirm a valid response. The operation outcome may be unknown.';
    } else if (error instanceof ApplicationError) {
      code = error.code;
      status = errorStatus[error.code];
      message = error.message;
      executionId = error.executionId ?? null;
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
    if (status >= 500) {
      request.log.error({ code }, 'Request dependency failure');
    }
    const payload = {
      error: {
        code,
        message,
        retryable: status === 503,
        request_id: request.id,
        execution_id: executionId,
      },
    } satisfies ApiErrorResponse;
    response.code(status).send(payload);
  }
}
