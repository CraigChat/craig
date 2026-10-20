import { json } from '@sveltejs/kit';

import { disconnectService } from '$lib/server/data';
import { checkAuth } from '$lib/server/discord';
import { SESSION_COOKIE } from '$lib/server/jwt';
import { rateLimitRequest } from '$lib/server/redis';
import { errorResponse } from '$lib/server/util';
import { APIErrorCode } from '$lib/types';

import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ cookies, getClientAddress }) => {
  const rlResponse = await rateLimitRequest({ cookies, getClientAddress }, { prefix: 'disconnect-microsoft', limit: 5, window: 60 });
  if (rlResponse) return rlResponse;

  const sessionCookie = cookies.get(SESSION_COOKIE);
  const auth = sessionCookie?.trim() ? await checkAuth(sessionCookie) : null;
  if (!auth) return errorResponse(APIErrorCode.UNAUTHORIZED, { status: 401 });

  await disconnectService(auth.id, 'onedrive', (tx) => tx.microsoftUser.deleteMany({ where: { id: auth.id } }));

  return json({ ok: true });
};
