import 'server-only';
import { headers } from 'next/headers';
import { cookieValue } from '../http/security';
import { redirect } from 'next/navigation';
import { webRuntime } from '../runtime';

export async function requireConsoleUser() {
  const runtime = await webRuntime();
  const header = await headers();
  const host = header.get('host');
  if (
    !host ||
    !runtime.config.allowedOrigins.some(
      (origin) => new URL(origin).host === host,
    )
  ) {
    redirect('/');
  }
  if (runtime.config.local) {
    return {
      name: 'Local operator',
      subject: 'local-development',
      local: true,
    };
  }
  if (!runtime.config.hosting || !runtime.sessions) {
    redirect('/');
  }
  const reference = cookieValue(
    new Request(runtime.config.publicOrigin, { headers: header }),
    runtime.config.hosting.cookieName,
  );
  if (!(await runtime.sessions.access(reference))) {
    redirect('/');
  }
  const session = await runtime.sessions.read(reference);
  if (!session) {
    redirect('/');
  }
  return { ...session.user, local: false };
}
