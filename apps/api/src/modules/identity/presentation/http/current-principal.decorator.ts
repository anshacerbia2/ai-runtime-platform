import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApplicationError } from '../../../../shared/domain/application-error.js';
import {
  PRINCIPAL,
  type AuthenticatedRequest,
} from './authenticated-request.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>()[
      PRINCIPAL
    ];
    if (!principal) {
      throw new ApplicationError('UNAUTHENTICATED', 'Principal required.');
    }
    return principal;
  },
);
