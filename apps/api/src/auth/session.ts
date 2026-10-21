import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { SessionUser } from '@agentfit/contracts';
import type { createAuth } from './auth';
export function sessionReader(auth: ReturnType<typeof createAuth>) {
  return async (headers: IncomingHttpHeaders): Promise<SessionUser | null> => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
    return session ? { id: session.user.id, name: session.user.name, image: session.user.image } : null;
  };
}
