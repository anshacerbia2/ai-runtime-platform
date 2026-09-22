import { callback } from '../../../server/auth/handlers';
import { webRuntime } from '../../../server/runtime';
import { failure } from '../../../server/http/security';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    return await callback(request, await webRuntime());
  } catch (error) {
    return failure(error);
  }
}
