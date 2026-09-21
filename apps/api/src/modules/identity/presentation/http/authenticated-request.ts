import type { FastifyRequest } from 'fastify';
import type { ApplicationIdentity } from '../../domain/application-identity.js';

/** Symbol-backed request context avoids ad-hoc req.user/req.db namespace mutation. */
export const APPLICATION_IDENTITY = Symbol('AuthenticatedApplication');

export type AuthenticatedRequest = FastifyRequest & {
  [APPLICATION_IDENTITY]?: ApplicationIdentity;
};
