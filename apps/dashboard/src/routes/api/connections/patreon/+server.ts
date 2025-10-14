import { checkAuth } from '$lib/server/discord';
import { rateLimitRequest } from '$lib/server/redis';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@craig/db';
import { resolveUserEntitlement } from '$lib/server/patreon';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

export const DELETE: RequestHandler = async ({ cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'disconnect-patreon', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get('session');
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: auth.id } });
  // TODO use error response here
  if (!user) return json({ message: 'No user data' }, { status: 400 });
  if (!user.patronId) return json({ message: 'No patreon ID linked' }, { status: 400 });

  const entitlement = await prisma.entitlement.findUnique({
    where: {
      userId_source: {
        userId: auth.id,
        source: 'patreon'
      }
    }
  });
  if (entitlement)
    await prisma.entitlement.delete({
      where: {
        userId_source: {
          userId: auth.id,
          source: 'patreon'
        }
      }
    });
  await resolveUserEntitlement(auth.id, null);

  return json({ ok: true });
};
