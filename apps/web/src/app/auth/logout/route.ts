import { logout } from '../../../server/auth/handlers';
import { webRuntime } from '../../../server/runtime';
import { failure } from '../../../server/http/security';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    return await logout(request, await webRuntime());
  } catch (error) {
    return failure(error);
  }
}
