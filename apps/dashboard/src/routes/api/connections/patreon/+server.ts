import { db } from '@craig/db';
import { json } from '@sveltejs/kit';

import { checkAuth } from '$lib/server/discord';
import { SESSION_COOKIE } from '$lib/server/jwt';
import { resolveUserEntitlement } from '$lib/server/patreon';
import { rateLimitRequest } from '$lib/server/redis';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'disconnect-patreon', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  const user = await db.selectFrom('User').select('patronId').where('id', '=', auth.id).executeTakeFirst();
  // TODO use error response here
  if (!user) return json({ message: 'No user data' }, { status: 400 });
  if (!user.patronId) return json({ message: 'No patreon ID linked' }, { status: 400 });

  await db.deleteFrom('Entitlement').where('userId', '=', auth.id).where('source', '=', 'patreon').execute();
  await resolveUserEntitlement(auth.id, null);

  return json({ ok: true });
};
