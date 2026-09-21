import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticateApplication } from '../../application/authenticate-application.js';
import {
  APPLICATION_IDENTITY,
  type AuthenticatedRequest,
} from './authenticated-request.js';
import { PUBLIC_ROUTE } from '../../../../shared/presentation/public-route.decorator.js';

@Injectable()
export class LocalAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthenticateApplication)
    private readonly authenticate: AuthenticateApplication,
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
    request[APPLICATION_IDENTITY] = await this.authenticate.execute(token);
    return true;
  }
}
