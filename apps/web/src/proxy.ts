import type { NextRequest } from 'next/server';
import { pagePolicy } from './server/http/page-policy';

export function proxy(request: NextRequest): Response {
  return pagePolicy(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
