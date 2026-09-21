import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatePrincipal } from '../../application/authenticate-principal.js';
import {
  APPLICATION_IDENTITY,
  PRINCIPAL,
  type AuthenticatedRequest,
} from './authenticated-request.js';
import { PUBLIC_ROUTE } from '../../../../shared/presentation/public-route.decorator.js';
import { ApplicationError } from '../../../../shared/domain/application-error.js';

@Injectable()
export class LocalAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthenticatePrincipal)
    private readonly authenticate: AuthenticatePrincipal,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : undefined;
    const principal = await this.authenticate.execute(token);
    request[PRINCIPAL] = principal;
    if (principal.kind === 'application' && principal.applicationId) {
      request[APPLICATION_IDENTITY] = {
        applicationId: principal.applicationId,
      };
    }
    if (
      request.url.startsWith('/api/m0/') &&
      principal.kind !== 'application'
    ) {
      throw new ApplicationError(
        'POLICY_DENIED',
        'Application caller required.',
      );
    }
    return true;
  }
}
