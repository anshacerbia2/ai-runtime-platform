import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import {
  loadWebEnvironment,
  type WebEnvironment,
} from '../../../../../config/environment.mjs';
import { failure, HttpFailure } from './security';

/** Runtime policy: the issuer is allowed only as an OIDC form-redirect target. */
export function browserPolicy(config: WebEnvironment): string {
  const issuer = config.auth ? ' ' + new URL(config.auth.issuer).origin : '';
  return (
    "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" +
    issuer
  );
}

export function pagePolicy(request: NextRequest): Response {
  try {
    const config = loadWebEnvironment();
    const host = request.headers.get('host');
    if (
      !host ||
      !config.allowedOrigins.some((origin) => new URL(origin).host === host)
    ) {
      throw new HttpFailure(403, 'HOST_DENIED');
    }
    const response = NextResponse.next();
    response.headers.set('Content-Security-Policy', browserPolicy(config));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return failure(error);
  }
}
