import { forward } from '../../../server/api-gateway/forward';
import { webRuntime } from '../../../server/runtime';
import { failure } from '../../../server/http/security';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

async function handler(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    return await forward(request, path, await webRuntime());
  } catch (error) {
    return failure(error);
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
