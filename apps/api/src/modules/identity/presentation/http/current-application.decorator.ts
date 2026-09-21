import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApplicationError } from '../../../../shared/domain/application-error.js';
import type { ApplicationIdentity } from '../../domain/application-identity.js';
import {
  APPLICATION_IDENTITY,
  type AuthenticatedRequest,
} from './authenticated-request.js';

export const CurrentApplication = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApplicationIdentity => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const identity = request[APPLICATION_IDENTITY];
    if (!identity) {
      throw new ApplicationError(
        'UNAUTHENTICATED',
        'Application identity unavailable.',
      );
    }
    return identity;
  },
);
