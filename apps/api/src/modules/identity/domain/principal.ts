import { ApplicationError } from '../../../shared/domain/application-error.js';

export interface Principal {
  subject: string;
  kind: 'application' | 'operator' | 'runner';
  applicationId?: string;
  scopes: readonly string[];
  roles: readonly string[];
}

export function requireAuthority(principal: Principal, scope: string) {
  const kind =
    scope.startsWith('platform:') || scope === 'usage:verify'
      ? 'operator'
      : scope.startsWith('runner:')
        ? 'runner'
        : 'application';
  const role =
    scope === 'usage:verify' ? 'platform-accountant' : 'platform-operator';
  if (
    principal.kind !== kind ||
    !principal.scopes.includes(scope) ||
    (kind === 'operator' &&
      !principal.roles.includes(role) &&
      !principal.roles.includes('platform-admin'))
  ) {
    throw new ApplicationError('POLICY_DENIED', 'Operation is not authorized.');
  }
}
